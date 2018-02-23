pragma solidity ^0.4.19;

/* import './Hangman.sol'; */

contract LiveGame {

  event GameStarted(string uniqGameString);

  struct ActiveGame {
    string word;
    uint8 wager;
    uint8 maxTries;
    uint id;
    string uniqGameString;
    string hangman;
    string challenger;
    string[] guesses;
  }

  mapping (uint => ActiveGame) activeGamesMap;
  mapping (uint => address) gameToChallenger;

  function startLiveGame(string word, uint8 wager, uint8 maxTries, string uniqGameString, string hangman, string challenger) public {
    uint randId = _generateRandomId(uniqGameString);
    string[] memory guesses;
    gameToChallenger[randId] = msg.sender;
    activeGamesMap[randId] = ActiveGame(word, wager, maxTries, randId, uniqGameString, hangman, challenger, guesses);
    GameStarted(uniqGameString);
  }

  function _generateRandomId(string word) private pure returns (uint) {
    uint rand = uint(keccak256(word));
    return rand;
  }
}
