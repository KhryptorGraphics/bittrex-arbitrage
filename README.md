# README #

Bittrex arbitrage, automated triangular arbitrage on Bittrex.

### What is this repository for? ###

* People who want an automated way of making more money

### How do I get set up? ###

* Clone the repository somewhere on your box
* Install Node.js if you already haven't, https://nodejs.org/
* Run npm install
* Sign up to https://bittrex.com/
* Set up two factor authentication
* Create an API key
* Run this ```echo { "apikey": "", "apisecret": "" } >> bittrexoptions.json && echo { "mode": "instant", "risk" : 0.25, "minProfitFactor": 0.01, "inputBtc": 0.0006 } >> config.json``` to create your configuration files.
	* Configure your API key and secret in bittrexoptions.json
	* Configure your settings in config.json to your needs
* Deposit some funds to Bittrex, it is recommended anno 2017 to deposit at least 0.005 BTC.
	* After testing it seems that ETH routes generally do not have regular volume.
	* Three recommended currencies are USDT, BTC and XRP you do not have to restrict yourself to these pairs
	* _NOTE: each currency balance value should be at least the configured "inputBtc" in BTC value._
* Spread your funds evenly accross some currencies that will create a few routes, it is recommended to use currency pairs with regular volume.
	* Example: When "inputBtc" is 0.0006 and you have USDT, BTC and XRP, make sure you have at least 0.0006 BTC, 0.0006 BTCs worth of XRP, and 0.0006 BTCs worth of USDT
* run main.js ```node main.js```

### Create config files with command line ###
```echo { "apikey": "", "apisecret": "" } >> bittrexoptions.json && echo { "mode": "instant", "risk" : 0.25, "minProfitFactor": 0.01, "inputBtc": 0.0006 } >> config.json```

### Configuration ###
##### mode #####
* "instant"
	* Opens orders when there is an instant profit to be made, the only risk is if an order gets filled quicker than you opened your order, profits will be marginal but profit none the less
* "instantMinus"
	* Open orders similar to "instant" with slightly less profit margin, to try and be quicker than anyone else
* "instantPlus"
	* The oposite of instant plus, tries create more profit margin, the orders may not fill instantly
* "potential"
	* Go in the oposite direction of instant, place orders that will make profit, but probably not instantly, higher profit margin than instant but more risky
* "potentialMinus"
	* The same as potential, only with less profit margin in an attempt to reduce risk and potential waiting time
* "potentialPlus"
	* Try make even more profit than when running in potential, rather risky, orders will probably be open for relativley long periods of time
* "median"
	* Split the difference between bid and ask, open your order slap bang in the middle

##### risk #####
The percentage of maximum available capital to use when placing trades

##### minProfitFactor ######
The minimum profit factor as a percentage, to make on at least one of the currencies before opening trades

##### inputBtc #####
Bittrex has a limit on the minimum value of currency you are alowed to trade, the value of the trade must be at least 0.0005 BTC, it is recommended to keep this above that value because of discrepancies

### Contribution guidelines ###
* Contribute in any way you think will be constructive
* Make a fork
* Make a pull request