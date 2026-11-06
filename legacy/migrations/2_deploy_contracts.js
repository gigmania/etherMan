let PendingGame = artifacts.require('./PendingGame.sol');
let LiveGame = artifacts.require('./LiveGame.sol');
let Hangman = artifacts.require('./Hangman.sol');

module.exports = function(deployer) {
  deployer.deploy(PendingGame);
  deployer.link(PendingGame, LiveGame);
  deployer.deploy(LiveGame);
  deployer.link(LiveGame, Hangman);
  deployer.deploy(Hangman);
};
