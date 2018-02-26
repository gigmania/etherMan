import React, { Component } from 'react';
import Header from './Header';

import './liveGame.css';

class LiveGame extends Component {
  constructor(props) {
    super(props);

    this.state = {
      misses: [],
      hits: [],
      solution: []
    };
  }
  componentDidMount() {
    if (this.props.wordLength) {
      let wordLength = this.props.wordLength;
      let hiddenWord = [];
      while (wordLength > 0) {
        hiddenWord.push('');
        wordLength--;
      }
      this.setState({
        solution: hiddenWord
      });
    }
  }
  render() {
    console.log('rednering liveGame');
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
      </div>
    );
  }
}
export default LiveGame;
