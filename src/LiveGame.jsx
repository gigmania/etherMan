import React, { Component } from 'react';
import Header from './Header';

import './liveGame.css';

class LiveGame extends Component {
  constructor(props) {
    super(props);

    this.state = {
      misses: [],
      hits: [],
      solution: [],
      guess: ''
    };
    this.updateGuess = this.updateGuess.bind(this);
    this.submitGuess = this.submitGuess.bind(this);
  }
  componentDidMount() {
    if (this.props.solution) {
      this.setState({
        solution: this.props.solution
      });
    }
  }
  updateGuess(e) {
    e.preventDefault();
    this.setState({
      guess: e.target.value
    });
  }
  submitGuess(e) {
    e.preventDefault();
    let hangmanInstance;
    let self = this;
    let account = this.props.accounts[5];
    let guess = self.state.guess.toLowerCase().trim();
    let solutionString = this.props.solution.join('').trim();
    this.props.hangmanContract
      .deployed()
      .then(function(instance) {
        hangmanInstance = instance;
        return hangmanInstance.checkGuess(self.state.guess, self.props.gameId, {
          from: account,
          gas: 3000000
        });
      })
      .then(function(result) {
        console.log('i am the guesssssss result ---> ', result);
        self.setState({
          guess: ''
        });
      })
      .catch(function(err) {
        console.log(err);
      });
  }
  render() {
    console.log('rednering liveGame ---> ', this.props);
    let triesRemaining = this.props.maxTries - this.props.tries;
    return (
      <div className="main-box">
        <Header />
        <div className="header-title flex-justify">
          <div className="games-list-title">
            <h1>Etherman</h1>
            <h2>A PvP game of Hangman for Ether</h2>
          </div>
        </div>
        <div className="live-game-title">
          <h1>{this.props.hangman}</h1>
          <h2 className="live-game__vs"> vs </h2>
          <h1>{this.props.challenger}</h1>
        </div>
        <div className="live-game-solution">
          {this.state.solution.map((letter, index) => {
            return (
              <div className="solution-letter" key={index}>
                {letter}
              </div>
            );
          })}
        </div>
        <div className="live-game-misses">
          <h1> You have </h1> <h2> {triesRemaining} </h2> <h1> tries remaining. </h1>
        </div>
        <div className="live-game-guess">
          <input
            id="guess__input"
            type="text"
            placeholder="Enter Letter or Word Guess Here"
            value={this.state.guess}
            onChange={this.updateGuess}
          />
          <button className="submit-guess__btn" onClick={this.submitGuess}>
            Submit Guess
          </button>
        </div>
      </div>
    );
  }
}
export default LiveGame;
