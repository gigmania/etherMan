import React, { Component } from 'react';
import { Route, Switch } from 'react-router-dom';
import HangmanContract from '../build/contracts/Hangman.json';
import getWeb3 from './utils/getWeb3';
import GamesList from './GamesList/GamesList';
import CreateGame from './CreateGame/CreateGame';
import ListGame from './ListGame/ListGame';
import LiveGame from './LiveGame/LiveGame';

import './css/oswald.css';
import './css/open-sans.css';
import './css/pure-min.css';
import './App.css';

class App extends Component {
  constructor(props) {
    super(props);

    this.state = {
      storageValue: 0,
      web3: null,
      pendingGameIds: {},
      pendingGames: [],
      hangmanContract: undefined,
      account: undefined,
      accounts: [],
      liveGame: {}
    };
    this.addGameToGames = this.addGameToGames.bind(this);
    this.handlePendingGameResult = this.handlePendingGameResult.bind(this);
    this.handleNewGameResult = this.handleNewGameResult.bind(this);
    this.handleLiveGameResult = this.handleLiveGameResult.bind(this);
    this.handleGuessResult = this.handleGuessResult.bind(this);
    this.handleWinnerResult = this.handleWinnerResult.bind(this);
    this.gameMaker = this.gameMaker.bind(this);
    this.liveGameMaker = this.liveGameMaker.bind(this);
  }

  componentDidMount() {
    console.log('app component mountimg');
  }

  componentWillMount() {
    // Get network provider and web3 instance.
    // See utils/getWeb3 for more info.

    getWeb3
      .then(results => {
        this.setState({
          web3: results.web3
        });

        // Instantiate contract once web3 provided.
        this.instantiateContract();
      })
      .catch(() => {
        console.log('Error finding web3.');
      });
  }
  addGameToGames(game) {
    let gameIds = this.state.pendingGameIds;
    let games = this.state.pendingGames;
    if (this.state.pendingGameIds[game.userWord] == null) {
      gameIds[game.userWord] = game.userWord;
      games.push(game);
      this.setState({
        pendingGameIds: gameIds,
        pendingGames: games
      });
    }
  }
  handlePendingGameResult(pendingGame) {
    let game = this.gameMaker(pendingGame.args);
    //console.log(pendingGame);
    this.addGameToGames(game);
  }
  handleNewGameResult(newGame) {
    console.log('new game ---> ', newGame);
    let game = this.gameMaker(newGame.args);
    this.addGameToGames(game);
  }
  gameMaker(game) {
    let userName = game.userName;
    let userWord = game.userWord;
    let wager = game.wager.c[0];
    let tries = game.tries.c[0];
    let wordLength = game.wordLength.c[0];
    let gameId = game.gameId.c[0];
    return {
      wager,
      tries,
      userName,
      userWord,
      wordLength,
      gameId
    };
  }

  liveGameMaker(game) {
    let hangman = game.hangman;
    let challenger = game.challenger;
    let uniqGameString = game.uniqGameString;
    let wager = game.wager.c[0];
    let maxTries = game.maxTries.c[0];
    let tries = 0;
    if (game.tries) {
      tries = game.tries.c[0];
    }
    let gameId;
    if (game.gameId) {
      gameId = game.gameId.c[0];
    }
    let wordLength = game.wordLength.c[0];
    let solution = [];
    let misses = [];
    return {
      wager,
      maxTries,
      hangman,
      challenger,
      uniqGameString,
      wordLength,
      gameId,
      solution,
      misses,
      tries
    };
  }

  handleLiveGameResult(liveGame) {
    let game = this.liveGameMaker(liveGame.args);
    let wordLength = game.wordLength;
    while (wordLength > 0) {
      game.solution.push('');
      wordLength--;
    }
    this.setState({
      liveGame: game
    });
  }

  handleSolutionCheck(letter) {
    letter = letter.args;
    let solutionLetter = letter.letter.toUpperCase();
    let letterIndex = letter.index.c[0];
    let liveGame = this.state.liveGame;
    liveGame.solution[letterIndex] = solutionLetter;
    this.setState({
      liveGame: liveGame
    });
  }

  handleMissesCheck(letter) {
    letter = letter.args;
    let missesLetter = letter.letter.toUpperCase();
    let letterIndex = letter.index.c[0];
    let liveGame = this.state.liveGame;
    liveGame.misses.push(missesLetter);
    this.setState({
      liveGame: liveGame
    });
  }

  handleGuessResult(guess) {
    guess = guess.args;
    let guessLetter = guess.guess.toUpperCase();
    let letterIndex = guess.index.c[0];
    let liveGame = this.state.liveGame;
    liveGame.tries++;
    if (guess.hit === true) {
      liveGame.solution[letterIndex] = guessLetter;
    }
    if (guess.hit === false) {
      liveGame.misses.push(guessLetter);
    }
    this.setState({
      liveGame: liveGame
    });
  }

  handleWinnerResult(gameWinner) {
    let winner = gameWinner.args;
    console.log(winner);
  }

  checkGetLiveGame() {
    if (this.state.liveGame.hangman == null) {
      let hangmanInstance;
      let account = this.state.accounts[5];
      let time = new Date().getTime();
      this.state.hangmanContract
        .deployed()
        .then(function(instance) {
          hangmanInstance = instance;
          return hangmanInstance.getActiveGame({
            from: account,
            gas: 3000000
          });
        })
        .catch(function(err) {
          console.log(err);
        });
    }
  }

  instantiateContract() {
    let self = this;
    const contract = require('truffle-contract');
    const Hangman = contract(HangmanContract);
    Hangman.setProvider(this.state.web3.currentProvider);
    this.setState({
      hangmanContract: Hangman
    });

    let hangmanInstance;

    // Get accounts.
    this.state.web3.eth.getAccounts((error, accounts) => {
      this.state.hangmanContract.deployed().then(instance => {
        hangmanInstance = instance;
        hangmanInstance.PendingGame(function(error, result) {
          self.handlePendingGameResult(result);
        });
        hangmanInstance.NewGame(function(error, result) {
          self.handleNewGameResult(result);
        });
        hangmanInstance.getPendingGames({ from: accounts[0] }).then(function(result) {
          hangmanInstance.getActiveGame({
            from: self.state.accounts[5],
            gas: 3000000
          });
        });
        this.setState({
          account: accounts[0],
          accounts: accounts
        });
        hangmanInstance.GameStarted(function(error, result) {
          self.handleLiveGameResult(result);
        });
        hangmanInstance.SolutionGuess(function(error, result) {
          self.handleGuessResult(result);
        });
        hangmanInstance.GameWinner(function(error, result) {
          self.handleWinnerResult(result);
          console.log('I am the GAME WINNER ---> ', result);
        });
        hangmanInstance.ActiveGameDetails(function(error, result) {
          self.handleLiveGameResult(result);
        });
        hangmanInstance.SolutionCheck(function(error, result) {
          self.handleSolutionCheck(result);
        });
        hangmanInstance.MissesCheck(function(error, result) {
          self.handleMissesCheck(result);
        });
      });
    });
  }

  render() {
    return (
      <div className="App">
        <Switch>
          <Route
            exact
            path="/"
            component={() => (
              <GamesList
                pendingGames={this.state.pendingGames}
                accounts={this.state.accounts}
                web3={this.state.web3}
                hangmanContract={this.state.hangmanContract}
              />
            )}
          />
          <Route
            path="/create-game"
            component={() => <CreateGame accounts={this.state.accounts} hangmanContract={this.state.hangmanContract} />}
          />
          <Route
            path="/live-game/:id"
            component={props => {
              const routeId = props.match.params.id.trim();
              return (
                <LiveGame
                  hangmanContract={this.state.hangmanContract}
                  accounts={this.state.accounts}
                  {...this.state.liveGame}
                />
              );
            }}
          />
        </Switch>
      </div>
    );
  }
}

export default App;
