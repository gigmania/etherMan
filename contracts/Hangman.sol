pragma solidity ^0.4.19;

contract Hangman {

  event NewGame(uint gameId, uint8 wager, uint8 tries, string userName, string userWord, uint8 wordLength);
  event PendingGame(uint gameId, uint8 wager, uint8 tries, string userName, string userWord, uint8 wordLength);
  event GameStarted(string challenger, string hangman, uint gameId, uint8 wager, uint8 tries, string uniqGameString, uint8 wordLength);

  struct Game {
    string word;
    uint8 wager;
    uint8 tries;
    string userWord;
    string userName;
    uint8 wordLength;
  }

  struct ActiveGame {
    string word;
    uint8 wager;
    uint8 maxTries;
    string uniqGameString;
    string hangman;
    string challenger;
    uint8 tries;
    string[] hits;
    string[] misses;
    uint8 wordLength;
  }

  Game[] public games;
  ActiveGame[] public activeGames;
  mapping(uint => string) public idToWord;

  function createGame(string _word, uint8 _wager, uint8 _tries, string _userWord, string _userName, uint8 _wordLength) public {
    uint id = games.push(Game(_word, _wager, _tries, _userWord, _userName, _wordLength)) - 1;
    idToWord[id] = _word;
    NewGame(id, _wager, _tries, _userName, _userWord, _wordLength);
  }

  function getPendingGames() public {
    require(games.length > 0);
    for(uint i = 0; i < games.length; i++) {
      PendingGame(i, games[i].wager, games[i].tries, games[i].userName, games[i].userWord, games[i].wordLength);
    }
  }

  function commenceLiveGame(string challenger, uint gameId, string uniqGameString, uint8 wordLength) public {
    string memory gameWord = games[gameId].word;
    //string memory gameWord = idToWord[gameId];
    uint8 tries = 0;
    string[] memory hits;
    string[] memory misses;
    uint id = activeGames.push(ActiveGame(gameWord, games[gameId].wager, games[gameId].tries, uniqGameString, games[gameId].userName, challenger, tries, hits, misses, wordLength)) - 1;
    GameStarted(challenger, games[gameId].userName, id, games[gameId].wager, tries, uniqGameString, wordLength);
  }
 }
