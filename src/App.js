import React, { Component } from 'react';
import { Route, Switch } from 'react-router-dom';
import HangmanContract from '../build/contracts/Hangman.json';
import LiveGameContract from '../build/contracts/LiveGame.json';
import getWeb3 from './utils/getWeb3';
import GamesList from './GamesList';
import CreateGame from './CreateGame';
import ListGame from './ListGame';

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
      accounts: []
    };
    this.addGameToGames = this.addGameToGames.bind(this);
    this.handlePendingGameResult = this.handlePendingGameResult.bind(this);
    this.handleNewGameResult = this.handleNewGameResult.bind(this);
    this.gameMaker = this.gameMaker.bind(this);
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
    let game = this.gameMaker(newGame.args);
    this.addGameToGames(game);
  }
  gameMaker(game) {
    let userName = game.userName;
    let word = game.word;
    let userWord = game.userWord;
    let wager = game.wager.c[0];
    let tries = game.tries.c[0];
    return {
      word,
      wager,
      tries,
      userName,
      userWord
    };
  }

  instantiateContract() {
    let self = this;
    const contract = require('truffle-contract');
    const Hangman = contract(HangmanContract);
    const LiveGame = contract(LiveGameContract);
    Hangman.setProvider(this.state.web3.currentProvider);
    LiveGame.setProvider(this.state.web3.currentProvider);
    this.setState({
      hangmanContract: Hangman,
      liveGameContract: LiveGame
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
          self.handlePendingGameResult(result);
        });
        hangmanInstance.getPendingGames({ from: accounts[0] });
        this.setState({
          account: accounts[0],
          accounts: accounts
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
                liveGameContract={this.state.liveGameContract}
              />
            )}
          />
          <Route
            path="/create-game"
            component={() => <CreateGame accounts={this.state.accounts} hangmanContract={this.state.hangmanContract} />}
          />
        </Switch>
      </div>
    );
  }
}

export default App;
