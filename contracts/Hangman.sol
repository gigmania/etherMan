pragma solidity ^0.4.19;

contract Hangman {

  event NewGame(uint gameId, string word, uint wager, uint tries, string userWord, string userName);
  event PendingGame(uint gameId, string word, uint wager, uint tries, string userWord, string userName);

  struct Game {
    string word;
    uint8 wager;
    uint8 tries;
    uint id;
    string userWord;
    string userName;
  }

  Game[] public games;

  function createGame(string _word, uint8 _wager, uint8 _tries, string _userWord, string _userName) public {
    uint randId = _generateRandomId(_userWord);
    uint id = games.push(Game(_word, _wager, _tries, randId, _userWord, _userName)) - 1;
    NewGame(id, _word, _wager, _tries, _userWord, _userName);
  }

  function _generateRandomId(string word) private pure returns (uint) {
    uint rand = uint(keccak256(word));
    return rand;
  }

  function getPendingGames() public {
    require(games.length > 0);
    for (uint i = 0; i < games.length; i++) {
      PendingGame(games[i].id, games[i].word, games[i].wager, games[i].tries, games[i].userWord, games[i].userName);
    }
  }
 }
