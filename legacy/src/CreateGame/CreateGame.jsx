import React, { Component } from 'react';
import { Link } from 'react-router-dom';

import Header from '../Header/Header';

import './createGame.css';

class CreateGame extends Component {
  constructor(props) {
    super(props);
    this.state = {
      userName: '',
      word: '',
      wager: undefined,
      tries: undefined
    };
    this.updateUserName = this.updateUserName.bind(this);
    this.updateWager = this.updateWager.bind(this);
    this.updateTries = this.updateTries.bind(this);
    this.updateWord = this.updateWord.bind(this);
    this.createNewGame = this.createNewGame.bind(this);
  }

  createNewGame(e) {
    let self = this;
    let hangmanInstance;
    let account = this.props.accounts[0];
    let balance = this.props.web3.eth.getBalance(account);
    balance = balance.c[0];
    let wager = new Number(this.state.wager).valueOf();
    if (balance >= wager) {
      let tries = new Number(this.state.tries).valueOf();
      let word = this.state.word.toLowerCase().trim();
      let userName = this.state.userName;
      let userWord = new Date().getTime() + userName + tries + ':000$' + wager;
      let wordLength = word.length;
      this.props.hangmanContract
        .deployed()
        .then(function(instance) {
          hangmanInstance = instance;
          return hangmanInstance.createGame(word, wager, tries, userWord, userName, wordLength, {
            from: account,
            gas: 3000000,
            value: wager
          });
        })
        .catch(function(err) {
          console.log(err);
        });
    } else {
      alert('not enough wei, mo fo');
    }
  }

  updateUserName(e) {
    e.preventDefault();
    this.setState({
      userName: e.target.value
    });
  }

  updateWord(e) {
    e.preventDefault();
    this.setState({
      word: e.target.value
    });
  }

  updateWager(e) {
    e.preventDefault();
    this.setState({
      wager: e.target.value
    });
  }

  updateTries(e) {
    e.preventDefault();
    this.setState({
      tries: e.target.value
    });
  }
  render() {
    return (
      <div className="main-box">
        <Header />
        <div className="header-title flex-justify">
          <div className="games-list-title">
            <h1>Etherman</h1>
            <h2>A PvP game of Hangman for Ether</h2>
          </div>
        </div>
        <div className="left-box">
          <div className="ether-user new-game-input">
            <input
              id="ether-user__input"
              type="text"
              placeholder="Enter UserName Here"
              value={this.state.userName}
              onChange={this.updateUserName}
            />
          </div>
          <div className="ether-word new-game-input">
            <input
              id="ether-word__input"
              type="text"
              placeholder="Enter Word Here"
              value={this.state.word}
              onChange={this.updateWord}
            />
          </div>
          <div className="ether-wager new-game-input">
            <input
              id="ether-wager__input"
              type="text"
              placeholder="Enter Wei Wager Amount Here"
              value={this.state.wager}
              onChange={this.updateWager}
            />
          </div>
          <div className="ether-guess new-game-input">
            <input
              id="ether-guess__input"
              type="text"
              placeholder="Enter the Number of Guesses"
              value={this.state.tries}
              onChange={this.updateTries}
            />
          </div>
          <div className="start-game">
            <Link className="react-link-btn" onClick={this.createNewGame} to="/">
              <button className="start-game__btn">Create Game</button>
            </Link>
          </div>
        </div>
      </div>
    );
  }
}

export default CreateGame;
