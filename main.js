console.log('Initiating...');

var fs = require('fs');
var clear = require('clear');
var process = require('process');

var bitrexoptions = JSON.parse(fs.readFileSync('./bittrexoptions.json', 'utf8'));
var config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

var modes = {
	median: 'median', // split the difference, risky but not as risky as potential
	last: 'last', // split the difference, risky but not as risky as potential
	potentialPlus: 'potentialPlus',
	potentialMinus: 'potentialMinus',
	potential: 'potential', // speculative and risky
	instant: 'instant', // 100% profit
	instantPlus: 'instantPlus',
	instantMinus: 'instantMinus',
	bull: 'bull', // drive prices up, quite risky
	bear: 'bear', // drive prices down, quite risky
	profit: 'profit'
};

var trading = false;
var trades = 0;
var startTime = Date.now();
var totalBtcStart;
var totalBtcNow;
var totalUsdtStart;
var totalUsdtNow;
var routesOutput = [];
var calculations = 1;
var startBalances = [];
var balances = [];
var routes = [];
var currencies = [];
var markets = [];
var orders = [];
var checkedOrders = 0;
var checkOrdersInterval;
var checkOrdersTimeout;
var pendingOrders = 0;
var cancelations = 1;
var runInterval;
var runTimeout;
var balanceInterval;
var routeIndex = 0;
var logInterval;
var logSpinner = 0;

var mode = config.mode;
var inputBtc = config.inputBtc; // input in BTC
var minProfitFactor = config.minProfitFactor; // minimum profit to make

var bittrex = require('./node.bittrex.api.js');
bittrex.options(bitrexoptions);


function getStartBalanceByCurrency(currency) {
	for (var i in startBalances) {
		if (startBalances[i].Currency === currency.Currency) {
			return startBalances[i];
		}
	}
}

function getUsdtAsBtc(quantity) {
	return calculateDelta(quantity, getMarketByName('USDT-BTC'), getCurrencyByName('USDT'), getPrice(true, getMarketByName('USDT-BTC'), getCurrencyByName('BTC')));
}

function addPlusOrSpace(number, decimals) {
	decimals = decimals === undefined ? 4 : decimals;
	var number = parseFloat(number);
	var str = '';
	if (number === 0) {
		str += ' ';
	}
	if (number < 0) {
		str += "\x1b[31m";
		str += '-';
	}
	if (number > 0) {
		str += "\x1b[32m";
		str += '+';
	}
	if (number < 10 && number > -10) {
		str += '0';
	}
	if (number < 100 && number > -100) {
		str += '0';
	}
	return str + number.toFixed(decimals).replace('-', '') + "\x1b[0m";
}

function getMinInput(currency, btcValue) {
	var input = Math.max(inputBtc, btcValue * config.risk);

	if (currency.Currency === 'USDT') {
		return calculateDelta(input, getMarketByName('USDT-BTC'), getCurrencyByName('BTC'), getPrice(true, getMarketByName('USDT-BTC'), getCurrencyByName('USDT')));
	}
	if (currency.Currency === 'BTC') {
		return input;
	}
	return reverseDelta(input, getBtcMarket(currency), getCurrencyByName('BTC'), getPrice(true, getBtcMarket(currency), currency));
}

function getBtcValue(currency, quantity) {
	if (currency.Currency === 'USDT') {
		return calculateDelta(quantity, getMarketByName('USDT-BTC'), getCurrencyByName('BTC'), getPrice(true, getMarketByName('USDT-BTC'), getCurrencyByName('USDT')));
	}
	return currency.Currency === 'BTC' ? quantity : reverseDelta(quantity, getBtcMarket(currency), currency, getPrice(true, getBtcMarket(currency), getCurrencyByName('BTC')));
}

function getCurrencyValue(currencyX, currencyY, quantity) {
	return reverseDelta(quantity, getMarketByCurrencies(currencyX, currencyY), currencyX, getPrice(true, getMarketByCurrencies(currencyX, currencyY), currencyY));
}

function getBtcMarket(currency) {
	var pair = 'BTC-' + currency.Currency;
	if (pair === 'BTC-USDT') {
		pair = 'USDT-BTC';
	}
	return getMarketByName(pair);
}

function getMarketByName(marketName) {
	for (var i in markets) {
		if (markets[i].MarketName === marketName) {
			return markets[i];
		}
	}
}

function getMarketByCurrencies(currencyX, currencyY) {
	for (var i in markets) {
		if (markets[i].MarketName === currencyX.Currency + '-' + currencyY.Currency
				|| markets[i].MarketName === currencyY.Currency + '-' + currencyX.Currency) {
			return markets[i];
		}
	}
}

function getCurrencyByName(currencyName) {
	for (var i in currencies) {
		if (currencies[i].Currency === currencyName) {
			return currencies[i];
		}
	}
}

function isBaseCurrency(currency, market) {
	return market.MarketName.split('-')[0] !== currency.Currency;
}

function getDownPrice(isBase, market, currency) {
	var type = isBase && isBaseCurrency(currency, market) ? 'buy' : 'sell';
	var price = 0;
	if (mode === modes.potential) {
		if (isBase && type === 'sell' || !isBase && type === 'buy') {
			price = market.Bid + 0.0000001;
		}
		if (isBase && type === 'buy' || !isBase && type === 'sell') {
			price = market.Ask - 0.0000001;
		}
	}
	return price;
}

function getPrice(isBase, market, currency, instant) {
	var type = isBase && isBaseCurrency(currency, market) ? 'buy' : 'sell';
	var price = 0;
	if (mode === modes.median) {
		var price = ((market.Bid + market.Ask) / 2)
	}
	if (mode === modes.last) {
		price = market.Last;
	}
	if (mode === modes.instantPlus) {
		if (isBase && type === 'sell') {
			price = market.Bid - ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
		if (!isBase && type === 'buy') {
			price = market.Bid - ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
		if (isBase && type === 'buy') {
			price = market.Ask + ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
		if (!isBase && type === 'sell') {
			price = market.Ask + ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
	}
	if (mode === modes.instantMinus) {
		if (isBase && type === 'sell') {
			price = market.Bid + ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
		if (!isBase && type === 'buy') {
			price = market.Bid + ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
		if (isBase && type === 'buy') {
			price = market.Ask - ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
		if (!isBase && type === 'sell') {
			price = market.Ask - ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
	}
	if (mode === modes.potentialPlus) {
		if (isBase && type === 'sell') {
			price = market.Ask + ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
		if (!isBase && type === 'buy') {
			price = market.Ask + ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
		if (isBase && type === 'buy') {
			price = market.Bid - ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
		if (!isBase && type === 'sell') {
			price = market.Bid - ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
	}
	if (mode === modes.potentialMinus) {
		if (isBase && type === 'sell') {
			price = market.Ask - ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
		if (!isBase && type === 'buy') {
			price = market.Ask - ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
		if (isBase && type === 'buy') {
			price = market.Bid + ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
		if (!isBase && type === 'sell') {
			price = market.Bid + ((market.Ask - (market.Bid + market.Ask) / 2) * 0.025);
		}
	}
	if (mode === modes.potential) {
		if (isBase && type === 'sell' || !isBase && type === 'buy') {
			price = market.Ask - 0.0000001;
		}
		if (isBase && type === 'buy' || !isBase && type === 'sell') {
			price = market.Bid + 0.0000001;
		}
	}
	if (mode === modes.instant || instant) {
		if (isBase && type === 'sell' || !isBase && type === 'buy') {
			price = market.Bid;
		}
		if (isBase && type === 'buy' || !isBase && type === 'sell') {
			price = market.Ask;
		}
	}
	return price;
}

function getQuantityAvailableAtPrice(isBase, orderBook, price) {
	var type = isBase ? 'sell' : 'buy';
	var quantity = 0;
	for (var i in orderBook[type]) {
		if ((isBase && orderBook[type][i].Rate <= price) || (!isBase && orderBook[type][i].Rate >= price)) {
			quantity = quantity + orderBook[type][i].Quantity;
		}
	}
	return quantity;
}

function calculateDelta(input, market, currency, price) {
	var isBase = isBaseCurrency(currency, market);
	var output = isBase ? (input * price) : (input / price);
	return  output - (output * /*currency.TxFee*/ 0.0025);
}

function getOppositePrice(isBase, market, currency) {
	var type = isBase && isBaseCurrency(currency, market) ? 'buy' : 'sell';
	var price = 0;

	if (isBase && type === 'sell' || !isBase && type === 'buy') {
		price = market.Bid;
	}
	if (isBase && type === 'buy' || !isBase && type === 'sell') {
		price = market.Ask;
	}
	return price;
}

function reverseDelta(input, market, currency, price) {
	var isBase = isBaseCurrency(currency, market);
	var output = isBase ? (input * price) : (input / price);
	return  output - (output * /*currency.TxFee*/ 0.0025);
}

function findRoutes() {
	if (balances.length > 2) {
		console.log('Finding routes...');
		for (var x in balances) {
			for (var y in balances) {
				if (balances[x] === balances[y]) {
					continue;
				}
				for (var z in balances) {
					if (balances[y] === balances[z] || balances[z] === balances[x]) {
						continue;
					}
					if (!routeExists(balances[x], balances[y], balances[z])) {
						var route = createRoute(balances[x], balances[y], balances[z]);
						if (route) {
							routes.push(route);
							console.log(route.routeString() + ' : ' + route.marketRouteString());
						}
					}
				}
			}
		}
	}
	checkOrdersInterval = setInterval(checkOrders, 1000);
	runInterval = setInterval(run, 1);
	logInterval = setInterval(log, 1000 / 30);
	balanceInterval = setInterval(updateBalances, 5000);
	setInterval(subscribeToMarkets, 1000/30);
}

function createRoute(currencyX, currencyY, currencyZ) {
	if (currencyX && currencyY && currencyZ) {
		var marketX = getMarketByCurrencies(currencyX, currencyY);
		var marketY = getMarketByCurrencies(currencyY, currencyZ);
		var marketZ = getMarketByCurrencies(currencyZ, currencyX);
		var routeObject;
		if (marketX && marketY && marketZ) {
			routeObject = new Route(currencyX, currencyY, currencyZ, marketX, marketY, marketZ);
		}
	}
	return routeObject;
}

function routeExists(currencyX, currencyY, currencyZ) {
	for (var i in routes) {
		if (routes[i].currencyX === currencyX
				&& routes[i].currencyY === currencyY
				&& routes[i].currencyZ === currencyZ) {
			return true;
		}
	}
	return false;
}


function countRoutesByCurrencyX(currencyX) {
	var count = 0;
	for (var i in routes) {
		if (routes[i].currencyX === currencyX) {
			count++;
		}
	}
	return count;
}


/**
 * Market Logic
 */

function subscribeToMarkets() {
	bittrex.getmarketsummaries(function (data, err) {
		if(data) {
			for (var i in data.result) {
				var market = getMarketByName(data.result[i].MarketName);
				if (market) {
					market.Bid = data.result[i].Bid;
					market.Ask = data.result[i].Ask;
					market.Last = data.result[i].Last;
				}
			}
		}
	});
}
;

function getMarketByName(marketName) {
	for (var i in markets) {
		if (markets[i].MarketName === marketName) {
			return markets[i];
		}
	}
}
;

var Market = function (market) {
	this.routes = [];
	this.gettingOrderBook = false;
	this.orderBook = [];

	Object.assign(this, market);

	markets.push(this);
};

Market.prototype = {
	constructor: Market,

	hasOrderBook: function () {
		return this.orderBook !== null;
	},

	isBaseCurrency: function (currency) {
		if (this.MarketName.split('-')[0] !== currency.Currency) {
			return true;
		}
		return false;
	},

	getOrderBook: function () {
		var _this = this;
		this.gettingOrderBook = true;
		bittrex.getorderbook({market: _this.MarketName, depth: 1, type: 'both'}, function (data, err) {
			if (err) {
				console.log('getorderbook error ' + _this.MarketName);
			} else {
				_this.orderBook = data.result;
				_this.calculateRoutes();
			}
			_this.gettingOrderBook = false;
		});
	}
};

/**
 * Route logic
 */
function Route(currencyX, currencyY, currencyZ, marketX, marketY, marketZ) {
	this.currencyX = currencyX;
	this.currencyY = currencyY;
	this.currencyZ = currencyZ;

	this.marketX = marketX;
	this.marketY = marketY;
	this.marketZ = marketZ;

	this.marketX.routes.push(this);
	this.marketY.routes.push(this);
	this.marketZ.routes.push(this);

	this.isXBase = this.marketX.isBaseCurrency(this.currencyX);
	this.isYBase = this.marketY.isBaseCurrency(this.currencyY);
	this.isZBase = this.marketZ.isBaseCurrency(this.currencyZ);
	this.priceX = 0;
	this.priceY = 0;
	this.priceZ = 0;
	this.minX = 0;
	this.minY = 0;
	this.minZ = 0;
	this.btcValueX = 0;
	this.btcValueY = 0;
	this.btcValueZ = 0;
	this.minBtcBalance = 0;
	this.deltaX = 0;
	this.deltaY = 0;
	this.deltaZ = 0;
	this.inputX = 0;
	this.inputY = 0;
	this.inputZ = 0;
	this.quantityX = 0;
	this.quantityY = 0;
	this.quantityZ = 0;
	this.profitX = 0;
	this.profitY = 0;
	this.profitZ = 0;
}

Route.prototype = {

	constructor: Route,

	routeString: function () {
		return this.currencyX.Currency + (this.currencyX.Currency.length < 4 ? ' ' : '') + ' > '
				+ this.currencyY.Currency + (this.currencyY.Currency.length < 4 ? ' ' : '') + ' > '
				+ this.currencyZ.Currency + (this.currencyZ.Currency.length < 4 ? ' ' : '') + ' > '
				+ this.currencyX.Currency + (this.currencyX.Currency.length < 4 ? ' ' : '');


	},

	marketRouteString: function () {
		return this.marketX.MarketName + (this.marketX.MarketName.length < 8 ? '  ' : ( this.marketX.MarketName.length < 9 ? ' ' : '')) + ' > '
				+ this.marketY.MarketName + (this.marketY.MarketName.length < 8 ? '  ' : ( this.marketY.MarketName.length < 9 ? ' ' : '')) + ' > '
				+ this.marketZ.MarketName + (this.marketZ.MarketName.length < 8 ? '  ' : ( this.marketZ.MarketName.length < 9 ? ' ' : ''));
	},

	getPrices: function () {
		this.priceX = getPrice(this.isXBase, this.marketX, this.currencyY);
		this.priceY = getPrice(this.isYBase, this.marketY, this.currencyZ);
		this.priceZ = getPrice(this.isZBase, this.marketZ, this.currencyX);
	},

	getBalances: function () {
		var balanceX = getBalanceByCurrencyName(this.currencyX.Currency);
		this.balanceX = balanceX === undefined ? 0 : balanceX.Available;
		var balanceY = getBalanceByCurrencyName(this.currencyY.Currency);
		this.balanceY = balanceY === undefined ? 0 : balanceY.Available;
		var balanceZ = getBalanceByCurrencyName(this.currencyZ.Currency);
		this.balanceZ = balanceZ === undefined ? 0 : balanceZ.Available;
	},

	getMinInputs: function () {
		this.btcBalanceX = this.currencyX.Currency === 'USDT' ? getUsdtAsBtc(this.balanceX) : getBtcValue(this.currencyX, this.balanceX);
		this.btcBalanceY = this.currencyY.Currency === 'USDT' ? getUsdtAsBtc(this.balanceY) : getBtcValue(this.currencyY, this.balanceY);
		this.btcBalanceZ = this.currencyZ.Currency === 'USDT' ? getUsdtAsBtc(this.balanceZ) : getBtcValue(this.currencyZ, this.balanceZ);
		this.minBtcBalance = Math.min(this.btcBalanceX, this.btcBalanceY, this.btcBalanceZ);
		this.minX = getMinInput(this.currencyX, this.minBtcBalance);
		this.minY = getMinInput(this.currencyY, this.minBtcBalance);
		this.minZ = getMinInput(this.currencyZ, this.minBtcBalance);
	},

	calculate: function () {
		this.getPrices();
		this.getBalances();
		this.getMinInputs();
		this.profitX = 0;
		this.profitY = 0;
		this.profitZ = 0;
		this.deltaX = calculateDelta(this.minBtcBalance, this.marketX, this.currencyX, this.priceX);
		this.deltaY = calculateDelta(this.deltaX, this.marketY, this.currencyY, this.priceY);
		this.deltaZ = calculateDelta(this.deltaY, this.marketZ, this.currencyZ, this.priceZ);
		this.inputX = this.minX;//Math.max(this.minX, this.deltaZ);
		this.inputY = this.minY;//Math.max(this.minY, this.deltaX);
		this.inputZ = this.minZ;//Math.max(this.minZ, this.deltaY);
		this.quantityX = calculateDelta(this.inputX, this.marketX, this.currencyX, this.priceX);
		this.quantityY = calculateDelta(this.inputY, this.marketY, this.currencyY, this.priceY);
		this.quantityZ = calculateDelta(this.inputZ, this.marketZ, this.currencyZ, this.priceZ);
		this.profitX = this.quantityX - this.inputY;
		this.profitY = this.quantityY - this.inputZ;
		this.profitZ = this.quantityZ - this.inputX;
		this.profitFactorX = (this.profitX / this.quantityX) * 100;
		this.profitFactorY = (this.profitY / this.quantityY) * 100;
		this.profitFactorZ = (this.profitZ / this.quantityZ) * 100;

		if (this.isProfitable() && this.hasEnoughBalance()) {
			clearInterval(runInterval);
			this.trade();
			setTimeout(function () {
				runInterval = setInterval(run, 1);
			}, 10000);
		}
	},

	isProfitable: function () {
		return Math.min(this.profitX, this.profitY, this.profitZ) >= 0
				&& Math.max(this.profitFactorX, this.profitFactorY, this.profitFactorZ) >= config.minProfitFactor;
	},

	hasEnoughBalance: function () {
		return this.balanceX >= this.inputX
				&& this.balanceY >= this.inputY
				&& this.balanceZ >= this.inputZ;
	},

	trade: function () {
		trade(this.isXBase ? this.inputX : this.inputY, this.priceX, this.marketX, this.currencyY, function (data, err) {});
		trade(this.isYBase ? this.inputY : this.inputZ, this.priceY, this.marketY, this.currencyZ, function (data, err) {});
		trade(this.isZBase ? this.inputZ : this.inputX, this.priceZ, this.marketZ, this.currencyX, function (data, err) {});
	},

	generateOutput: function () {
		return this.ouput = '[' + new Date().toLocaleTimeString() + '] '
				+ this.routeString()
				+ "\t" + this.marketRouteString()
				+ "\t" + this.inputX.toFixed(8)
				+ ' = ' + this.quantityX.toFixed(8)
				+ ' > ' + this.inputY.toFixed(8)
				+ ' = ' + this.quantityY.toFixed(8)
				+ ' > ' + this.inputZ.toFixed(8)
				+ ' = ' + this.quantityZ.toFixed(8)
				+ "\t" + addPlusOrSpace(this.profitX)
				+ ' ' + addPlusOrSpace(this.profitY)
				+ ' ' + addPlusOrSpace(this.profitZ)
				+ "\t" + addPlusOrSpace(this.profitFactorX, 3) + '% '
				+ addPlusOrSpace(this.profitFactorY, 3) + '% '
				+ addPlusOrSpace(this.profitFactorZ, 3) + "%";
	}
};

function trade(quantity, rate, market, currency, callback) {
	(function () {
		trades++;
		var trade = {
			MarketName: market.MarketName,
			OrderType: 'LIMIT',
			Quantity: quantity,
			Rate: rate,
			TimeInEffect: 'GOOD_TIL_CANCELLED', // supported options are 'IMMEDIATE_OR_CANCEL', 'GOOD_TIL_CANCELLED', 'FILL_OR_KILL'
			ConditionType: 'NONE', //isBase ? 'LESS_THAN' : 'GREATER_THAN', // supported options are 'NONE', 'GREATER_THAN', 'LESS_THAN'
			Target: 0 // used in conjunction with ConditionType
		};
		if (isBaseCurrency(currency, market)) {
			bittrex.tradebuy(trade, callback);
		} else {
			bittrex.tradesell(trade, callback);
		}
	})();
}

function log() {
	var output = '';
	var totalsOutput = '';
	var balancesOutput = '';
	var totalProfitFactor = 0;
	for (var x in balances) {
		var balanceX = balances[x];
		var currencyX = getCurrencyByName(balanceX.Currency);
		if (currencyX) {
			var startBalance = getStartBalanceByCurrency(currencyX);
			if (startBalance) {
				var start = startBalance.Balance;
				var startTotal = start;
				var now = balanceX.Balance;
				var currentTotal = now;
				var profit = now - start;
				var profitFactor = (profit / start * 100);

				var btcStart = currencyX.Currency === 'USDT' ? getUsdtAsBtc(start) : getBtcValue(currencyX, start);
				var btcNow = currencyX.Currency === 'USDT' ? getUsdtAsBtc(now) : getBtcValue(currencyX, now);
				var btcProfit = btcNow - btcStart;
				var btcProfitFactor = btcProfit / btcStart * 100;
				totalBtcStart += btcStart;
				totalBtcNow += btcNow;
				balancesOutput += ("[" + currencyX.Currency + "]"
						+ "\t\t" + start.toFixed(8)
						+ "\t" + now.toFixed(8)
						+ "\t" + addPlusOrSpace(profit, 8)
						+ "\t" + addPlusOrSpace(profitFactor, 4) + '%'
						+ "\t" + btcNow.toFixed(8)
						+ "\t\t" + addPlusOrSpace(btcProfit, 8)
						+ "\t\t" + addPlusOrSpace(btcProfitFactor, 4) + '%' + "\n");

				for (var y in balances) {
					var balanceY = balances[y];
					var currencyY = getCurrencyByName(balanceY.Currency);
					if (currencyY) {
						if (getMarketByCurrencies(currencyX, currencyY)) {
							var startBalanceY = getStartBalanceByCurrency(currencyY);
							if (startBalanceY) {
								currentTotal += getCurrencyValue(currencyY, currencyX, balances[y].Balance);
								startTotal += getCurrencyValue(currencyY, currencyX, startBalanceY.Balance);
							}
						}
					}
				}

				var currentProfit = currentTotal - startTotal;
				var currentProfitFactor = currentProfit / currentTotal * 100;
				totalProfitFactor += currentProfitFactor;
				totalsOutput += ("[Current " + currencyX.Currency + " total]"
						+ "\tStart:" + startTotal.toFixed(8)
						+ "\tvalue:" + currentTotal.toFixed(8)
						+ "\tCurrent profit:" + addPlusOrSpace(currentProfit, 8)
						+ "\tProfit factor:" + addPlusOrSpace(currentProfitFactor, 4) + "%\n");
			}
		}
	}

	output += ("\n\n" + 'Bittrex Arbitrage'
			+ "\t\t\t\t\t\tTrades: " + trades
			+ " Pending: " + pendingOrders + "\t\t");
	var timeDiff = Date.now() - startTime;
	var hh = Math.floor(timeDiff / 1000 / 60 / 60);
	timeDiff -= hh * 1000 * 60 * 60;
	var mm = Math.floor(timeDiff / 1000 / 60);
	timeDiff -= mm * 1000 * 60;
	var ss = Math.floor(timeDiff / 1000);
	hh = (hh < 10 ? '0' : '') + hh;
	mm = (mm < 10 ? '0' : '') + mm;
	ss = (ss < 10 ? '0' : '') + ss;

	output += ("Time Running: " + hh + ":" + mm + ":" + ss + "\n\n");
	var totalBtcStart = 0;
	var totalBtcNow = 0;
	output += ("[Currency]\tStart\t\tNow\t\tProfit\t\tProfit Factor\tCurrent BTC Value\tCurrency BTC Profit\tCurrency BTC Profit Factor\n");
	output += (balancesOutput + "\n");
	output += ("\n" + totalsOutput + "\n");
	output += ("Market conflicts:\n\n");
	for (var x in routes) {
		output += (routes[x].generateOutput()) + "\n";
	}
	output += ((logSpinner === 0 ? '\\' : logSpinner === 1 ? '-' : '/'));
	logSpinner++;
	try {
		process.stdout.cursorTo(0);
		clear();
	} catch (e) {

	}
	console.log(output);

//			{"Uuid":null,
//		"OrderUuid":"b189c925-1e54-4100-9cf0-61cb0b7e449d",
//		"Exchange":"USDT-DASH",
//		"OrderType":"LIMIT_BUY",
//		"Quantity":0.01111947,
//		"QuantityRemaining":0.01111947,
//		"Limit":299.63615111,
//		"CommissionPaid":0,
//		"Price":0,
//		"PricePerUnit":null,
//		"Opened":"2017-10-15T15:03:51.39",
//		"Closed":null,
//		"CancelInitiated":false,
//		"ImmediateOrCancel":false,
//		"IsConditional":true,
//		"Condition":"LESS_THAN",
//		"ConditionTarget":0}

	console.log("\nOrders\n");

	orders.sort(compare);
	console.log("Market\t\tType\t\tQuantity\tRemaining\tHolding\t\tCurrent price\tTarget price\tModify\t\tClose\t\tDifference\tPercentage")
	for (var i in orders) {
		var market = getMarketByName(orders[i].Exchange);
		var orderCurrencyNames = orders[i].Exchange.split('-');
		var currencyXName = orders[i].OrderType === 'LIMIT_BUY' ? orderCurrencyNames[0] : orderCurrencyNames[1];
		var currencyYName = orders[i].OrderType === 'LIMIT_BUY' ? orderCurrencyNames[1] : orderCurrencyNames[0];
		var currencyX = getCurrencyByName(currencyXName);
		var currencyY = getCurrencyByName(currencyYName);
		var isBase = isBaseCurrency(currencyXName, market);
		var holdingValue = reverseDelta(orders[i].QuantityRemaining, market, currencyY, orders[i].Limit);
		var currentValue = getCurrencyValue(currencyX, currencyY, holdingValue); //(orders[i].QuantityRemaining, market, currencyY, orders[i].Limit);
		var oppositePrice = getOppositePrice(isBase, market, currencyY);
		var modifyPrice = getPrice(isBaseCurrency(currencyYName, market), market, currencyY, true);
		var difference = (orders[i].OrderType === 'LIMIT_BUY' ? orders[i].Limit - modifyPrice : modifyPrice - orders[i].Limit);
		var differencePercentage = (difference / orders[i].Limit) * 100;

		console.log(orders[i].Exchange
				+ " \t" + orders[i].OrderType
				+ " \t" + orders[i].Quantity
				+ " \t" + orders[i].QuantityRemaining
				+ " \t" + holdingValue.toFixed(8)
				+ " \t" + currentValue.toFixed(8)
				+ " \t" + orders[i].Limit.toFixed(8)
				+ " \t" + modifyPrice.toFixed(8)
				+ " \t" + oppositePrice.toFixed(8)
				+ " \t" + addPlusOrSpace(difference)
				+ " \t" + addPlusOrSpace(differencePercentage) + "%");
	}
}

function checkOrders() {
	bittrex.getopenorders({}, function (data, err) {
		if (!err) {
			pendingOrders = data.result.length;
			orders = data.result;
//			if (data.result.length > 0) {
//				clearInterval(checkOrdersInterval);
//				modifyOrders();
//			}
		}
	});
}

function modifyOrders() {
//	for (var i in orders) {
//		var market = getMarketByName(orders[i].Exchange);
//		var orderCurrencyNames = orders[i].Exchange.split('-');
//		var currencyXName = orders[i].OrderType === 'LIMIT_BUY' ? orderCurrencyNames[0] : orderCurrencyNames[1];
//		var currencyYName = orders[i].OrderType === 'LIMIT_BUY' ? orderCurrencyNames[1] : orderCurrencyNames[0];
//		var currencyX = getCurrencyByName(currencyXName);
//		var currencyY = getCurrencyByName(currencyYName);
//		var isBase = isBaseCurrency(currencyXName, market);
//		var holdingValue = reverseDelta(orders[i].QuantityRemaining, market, currencyY, orders[i].Limit);
//		var currentValue = getCurrencyValue(currencyX, currencyY, holdingValue); //(orders[i].QuantityRemaining, market, currencyY, orders[i].Limit);
//		var oppositePrice = getOppositePrice(isBase, market, currencyY);
//		var modifyPrice = getPrice(isBaseCurrency(currencyYName, market), market, currencyY);
//		var difference = (orders[i].OrderType === 'LIMIT_BUY' ? orders[i].Limit - modifyPrice : modifyPrice - orders[i].Limit);
//		var differencePercentage = (difference / orders[i].Limit) * 100;
//
//		if (differencePercentage < config.stopLoss) {
//			var order = JSON.parse(JSON.stringify(orders[i]));
//
//			var modify = function (data, err) {
//				var trade = {
//					MarketName: order.Exchange,
//					OrderType: 'LIMIT',
//					Quantity: order.QuantityRemaining,
//					Rate: modifyPrice,
//					TimeInEffect: 'GOOD_TIL_CANCELLED', // supported options are 'IMMEDIATE_OR_CANCEL', 'GOOD_TIL_CANCELLED', 'FILL_OR_KILL'
//					ConditionType: 'NONE', //isBase ? 'LESS_THAN' : 'GREATER_THAN', // supported options are 'NONE', 'GREATER_THAN', 'LESS_THAN'
//					Target: 0 // used in conjunction with ConditionType
//				};
//				
//				if (err) {
//					clearInterval(logInterval);
//					console.log(err, trade);
//					modify();
//					return;
//				}
//				var callback = function (data, err) {
//					clearInterval(checkOrdersInterval);
//					if (err) {
//						clearInterval(logInterval);
//						console.log(err, trade);
////						modify();
//					} else {
//						clearTimeout(checkOrdersTimeout);
//						clearInterval(runInterval);
//						runInterval = setInterval(run, 1);
//						checkOrdersTimeout = setTimeout(function(){ checkOrdersInterval = setInterval(checkOrders, 1000); }, 10000);
//					}
//				};
//
//				if (isBase) {
//					bittrex.tradebuy(trade, callback);
//				} else {
//					bittrex.tradesell(trade, callback);
//				}
//			}
//			var cancel = function () {
//				clearInterval(checkOrdersInterval);
//				bittrex.cancel({uuid: order.OrderUuid}, function (data, err) {
//					if (err && err.message !== 'ORDER_NOT_OPEN') {
//						clearInterval(logInterval);
//						console.log(err);
//						cancel();
//					} else {
//						clearInterval(runInterval);
//						clearInterval(checkOrdersInterval);
//						setTimeout(modify, 30000);
//					}
//				});
//			}
//			cancel();
//		}
//	}
}

function getBalanceByCurrencyName(currencyName) {
	for (var i in balances) {
		if (balances[i].Currency === currencyName) {
			return balances[i];
		}
	}
}
function getBalanceByCurrency(currency) {
	for (var i in balances) {
		if (balances[i].Currency === currency.Currency) {
			return balances[i];
		}
	}
}

function updateBalances() {
	bittrex.getbalances(function (data, err) {
		if (!err) {
			balances = data.result;
		}
	});
}

function run() {
	cancelations = 1;
	calculations++;
	if (routeIndex === routes.length) {
		routeIndex = 0;
	}
	if (routes[routeIndex]) {
		routes[routeIndex].calculate();
		routeIndex++;
	}
}

function compare(a, b) {
	if (a.Opened < b.Opened)
		return -1;
	if (a.Opened > b.Opened)
		return 1;
	return 0;
}

bittrex.getmarketsummaries(function (data, err) {
	if (err) {
		console.log('!!!! Error: ' + err.message);
		return;
	}
	for (var i in data.result) {
		markets.push(new Market(data.result[i]));
	}
	bittrex.getcurrencies(function (data, err) {
		if (err) {
			console.log('!!!! Error: ' + err.message);
			return;
		}
		currencies = data.result;
		bittrex.getbalances(function (data, err) {
			if (!err) {
				for (var i in data.result) {
					if (data.result[i].Balance > 0) {
						startBalances.push(data.result[i]);
						balances.push(data.result[i]);
					}
				}
				findRoutes();
			}
		});

	});
}
);