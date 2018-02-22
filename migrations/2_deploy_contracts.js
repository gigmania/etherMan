var SimpleStorage = artifacts.require('./SimpleStorage.sol');
let Hangman = artifacts.require('./Hangman.sol');

module.exports = function(deployer) {
  deployer.deploy(SimpleStorage);
  deployer.deploy(Hangman);
};
