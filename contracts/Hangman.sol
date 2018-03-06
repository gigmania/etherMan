pragma solidity ^0.4.19;

import './LiveGame.sol';

contract Hangman is LiveGame {

  event FundTransfer(address contractAddress, uint wager, bool success);

  function createGame(string _word, uint _wager, uint8 _tries, string _userWord, string _userName, uint8 _wordLength) public payable {
    if (this.send(msg.value)) {
      reallyCreateGame(_word, _wager, _tries, _userWord, _userName, _wordLength);
    } else {
      FundTransfer(this, msg.value, false);
    }
  }

  function commenceLiveGame(string challenger, uint gameId, string uniqGameString, uint8 wordLength) public payable {
    if (this.send(msg.value)) {
      reallyCommenceLiveGame(challenger, gameId, uniqGameString, wordLength);
    } else {
      FundTransfer(this, msg.value, false);
    }
  }

  function getPendingGames() public {
    require(games.length > 0);
    for(uint i = 0; i < games.length; i++) {
      if (games[i].wordLength > 0) {
        PendingGames(i, games[i].wager, games[i].tries, games[i].userName, games[i].userWord, games[i].wordLength);
      }
    }
  }
 }
