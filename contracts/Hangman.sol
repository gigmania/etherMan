pragma solidity ^0.4.19;

contract Hangman {

  event NewGame(uint gameId, uint8 wager, uint8 tries, string userName, string userWord, uint8 wordLength);
  event PendingGame(uint gameId, uint8 wager, uint8 tries, string userName, string userWord, uint8 wordLength);
  event GameStarted(string challenger, string hangman, uint gameId, uint8 wager, uint8 maxTries, string uniqGameString, uint8 wordLength);
  event SolutionGuess(string guess, bool hit, uint32 index);
  event GameWinner(string winner);

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
    uint8 tries = 0;
    string[] memory hits;
    string[] memory misses;
    /* uint memory hitsLength = hits.length; */
    uint id = activeGames.push(ActiveGame(gameWord, games[gameId].wager, games[gameId].tries, uniqGameString, games[gameId].userName, challenger, tries, hits, misses, wordLength)) - 1;
    GameStarted(challenger, games[gameId].userName, id, games[gameId].wager, games[gameId].tries, uniqGameString, wordLength);
    for (uint32 i = 0; i < wordLength; i++) {
      activeGames[id].hits.push('$');
    }
  }

  function checkSolved(uint gameId) private {
    string memory gameWord = activeGames[gameId].word;
    bool isSolution = true;
    string memory letter;
    for (uint32 i = 0; i < activeGames[gameId].hits.length; i++) {
      letter = activeGames[gameId].hits[i];
      if (bytes(letter)[0] != bytes(gameWord)[i]) {
        isSolution = false;
        break;
      }
    }
    if (isSolution == true) {
      GameWinner(activeGames[gameId].challenger);
    }
    if (isSolution == false) {
      if (activeGames[gameId].tries >= activeGames[gameId].maxTries) {
        GameWinner(activeGames[gameId].hangman);
      }
    }
  }

  function checkHanged(uint gameId, string guess) private {
    if (activeGames[gameId].maxTries > activeGames[gameId].tries) {
      SolutionGuess(guess, false, 0);
    } else {
      GameWinner(activeGames[gameId].hangman);
    }
  }

  function checkGuess(string guess, uint gameId) public {
    activeGames[gameId].tries++;
    bool isHit = false;
    string memory gameWord = activeGames[gameId].word;
    for (uint32 i = 0; i < bytes(gameWord).length; i++) {
      if (bytes(gameWord)[i] == bytes(guess)[0]) {
        isHit = true;
        activeGames[gameId].hits[i] = guess;
        SolutionGuess(guess, true, i);
      }
    }
    if (isHit == true) {
      checkSolved(gameId);
    }
    if (isHit == false) {
      checkHanged(gameId, guess);
    }
  }
 }
