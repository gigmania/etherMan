let Hangman = artifacts.require('./Hangman.sol');

module.exports = function(deployer) {
  deployer.deploy(Hangman);
};
