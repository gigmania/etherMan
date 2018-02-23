let Hangman = artifacts.require('./Hangman.sol');
let LiveGame = artifacts.require('./LiveGame.sol');

module.exports = function(deployer) {
  deployer.deploy(Hangman);
  deployer.deploy(LiveGame);
};
