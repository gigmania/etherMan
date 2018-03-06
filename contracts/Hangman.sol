pragma solidity ^0.4.19;

contract Hangman {

  event NewGame(uint gameId, uint wager, uint8 tries, string userName, string userWord, uint8 wordLength);
  event PendingGame(uint gameId, uint wager, uint8 tries, string userName, string userWord, uint8 wordLength);
  event GameStarted(string challenger, string hangman, uint gameId, uint wager, uint8 maxTries, string uniqGameString, uint8 wordLength);
  event SolutionGuess(string guess, bool hit, uint32 index);
  event GameWinner(string winner, string word, string loser);
  event ActiveGameDetails(string challenger, string hangman, uint wager, uint8 maxTries, string uniqGameString, uint8 wordLength, uint8 tries, uint gameId);
  event SolutionCheck(string letter, uint32 index);
  event MissesCheck(string letter, uint32 index);
  event RemovePendingGame(string userWord);
  event FundTransfer(address contractAddress, uint wager, bool success);

  uint32 gamesArrayGaps = 0;

  struct Game {
    string word;
    uint wager;
    uint8 tries;
    string userWord;
    string userName;
    uint8 wordLength;
  }

  struct ActiveGame {
    string word;
    uint wager;
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
  mapping(address => uint) public activeGamesMap;

  function checkSendHits() private {
    string memory holder = '$';
    for (uint32 i = 0; i < activeGames[activeGamesMap[msg.sender]].hits.length; i++) {
      if (bytes(activeGames[activeGamesMap[msg.sender]].hits[i])[0] != bytes(holder)[0]) {
        SolutionCheck(activeGames[activeGamesMap[msg.sender]].hits[i], i);
      }
    }
  }

  function checkSendMisses() private {
    for (uint32 i = 0; i < activeGames[activeGamesMap[msg.sender]].misses.length; i++) {
      MissesCheck(activeGames[activeGamesMap[msg.sender]].misses[i], i);
    }
  }

  function getMapIndex(address challenger) private view returns(uint) {
    return activeGamesMap[challenger];
  }

  function getActiveGame() public {
    uint gameId = getMapIndex(msg.sender);
    ActiveGameDetails(activeGames[activeGamesMap[msg.sender]].challenger,
      activeGames[activeGamesMap[msg.sender]].hangman,
      activeGames[activeGamesMap[msg.sender]].wager,
      activeGames[activeGamesMap[msg.sender]].maxTries,
      activeGames[activeGamesMap[msg.sender]].uniqGameString,
      activeGames[activeGamesMap[msg.sender]].wordLength,
      activeGames[activeGamesMap[msg.sender]].tries,
      gameId
    );
    checkSendHits();
    checkSendMisses();
  }

  function () payable public {
    //FundTransfer(this, msg.value, true);
  }

  function holdFunds () public payable returns(bool success) {
    if (this.send(msg.value)) {
      return true;
    } else {
      return false;
    }
  }

  function reallyCreateGame(string _word, uint _wager, uint8 _tries, string _userWord, string _userName, uint8 _wordLength) private {
    uint id;
    if (gamesArrayGaps < 1) {
      id = games.push(Game(_word, _wager, _tries, _userWord, _userName, _wordLength)) - 1;
    } else {
      for (uint32 i = 0; i < games.length; i++) {
        if (games[i].wordLength == 0) {
          games[i] = Game(_word, _wager, _tries, _userWord, _userName, _wordLength);
          id = i;
          gamesArrayGaps--;
          break;
        }
      }
    }
    idToWord[id] = _word;
    NewGame(id, _wager, _tries, _userName, _userWord, _wordLength);
  }

  function createGame(string _word, uint _wager, uint8 _tries, string _userWord, string _userName, uint8 _wordLength) public payable {
    if (this.send(msg.value)) {
      reallyCreateGame(_word, _wager, _tries, _userWord, _userName, _wordLength);
    } else {
      FundTransfer(this, msg.value, false);
    }
  }

  function getPendingGames() public {
    require(games.length > 0);
    for(uint i = 0; i < games.length; i++) {
      if (games[i].wordLength > 0) {
        PendingGame(i, games[i].wager, games[i].tries, games[i].userName, games[i].userWord, games[i].wordLength);
      }
    }
  }

  function mapLiveGameToAddress(uint gameIndex) private {
    activeGamesMap[msg.sender] = gameIndex;
  }

  function initSolutionArray(uint8 wordLength, uint gameIndex) private {
    for (uint32 i = 0; i < wordLength; i++) {
      activeGames[gameIndex].hits.push('$');
    }
  }

  function removeGameFromPending(uint gameId) private {
    RemovePendingGame(games[gameId].userWord);
    delete games[gameId];
    gamesArrayGaps++;
  }

  function commenceLiveGame(string challenger, uint gameId, string uniqGameString, uint8 wordLength) public {
    string memory gameWord = games[gameId].word;
    uint8 tries = 0;
    string[] memory hits;
    string[] memory misses;
    uint id = activeGames.push(ActiveGame(gameWord, games[gameId].wager, games[gameId].tries, uniqGameString, games[gameId].userName, challenger, tries, hits, misses, wordLength)) - 1;
    GameStarted(challenger, games[gameId].userName, id, games[gameId].wager, games[gameId].tries, uniqGameString, wordLength);
    initSolutionArray(wordLength, id);
    mapLiveGameToAddress(id);
    removeGameFromPending(gameId);
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
      GameWinner(activeGames[gameId].challenger, activeGames[gameId].word, activeGames[gameId].hangman);
    }
    if (isSolution == false) {
      if (activeGames[gameId].tries >= activeGames[gameId].maxTries) {
        GameWinner(activeGames[gameId].hangman, activeGames[gameId].word, activeGames[gameId].challenger);
      }
    }
  }

  function checkHanged(uint gameId, string guess) private {
    if (activeGames[gameId].maxTries > activeGames[gameId].tries) {
      SolutionGuess(guess, false, 0);
      activeGames[gameId].misses.push(guess);
    } else {
      GameWinner(activeGames[gameId].hangman, activeGames[gameId].word, activeGames[gameId].challenger);
    }
  }

  function checkWordGuess(string guess, uint gameId) private {
    string memory gameWord = activeGames[gameId].word;
    bool isSolved = true;
    if (bytes(gameWord).length == bytes(guess).length) {
      for (uint32 i = 0; i < bytes(gameWord).length; i++) {
        if (bytes(gameWord)[i] != bytes(guess)[i]) {
          isSolved = false;
          checkHanged(gameId, guess);
          break;
        }
      }
      if (isSolved == true) {
        GameWinner(activeGames[gameId].challenger, activeGames[gameId].word, activeGames[gameId].hangman);
      }
    } else {
      checkHanged(gameId, guess);
    }
  }

  function checkGuess(string guess, uint gameId) public {
    activeGames[gameId].tries++;
    bool isHit = false;
    string memory gameWord = activeGames[gameId].word;
    if (bytes(guess).length > 1) {
      checkWordGuess(guess, gameId);
    } else if (bytes(guess).length == 1) {
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
 }
