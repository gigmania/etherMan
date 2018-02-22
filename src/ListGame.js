import React from 'react';
import HangmanContract from '../build/contracts/Hangman.json';
import getWeb3 from './utils/getWeb3';

const ListGame = props => {
  let pendingGames = this.props.pendingGames;
  let gamesList;
  if (this.state.pendingGames && this.state.pendingGames.length > 0) {
    gamesList = (
      <div className="pending-games">
        <div className="pending-games__header">
          <div className="header-user user header-title">Hangman</div>
          <div className="header-letters letters header-title">Number of Letters</div>
          <div className="header-wager wager header-title">Wager</div>
          <div className="header-tries tries header-title">Tries</div>
        </div>
        {pendingGames.map(game => {
          return (
            <div className="pending-game" key={game.userWord}>
              <div className="game-attr user">
                <b> {game.userName} </b>
              </div>
              <div className="game-attr letters">
                <b> {game.word.length} </b>
              </div>
              <div className="game-attr wager">
                <b> {game.wager} </b>
              </div>
              <div className="game-attr tries">
                <b> {game.tries} </b>
              </div>
              <div className="game-attr play-game">
                <button className="play-game__btn">PLAY</button>
              </div>
            </div>
          );
        })}
      </div>
    );
  } else {
    gamesList = <h2> Hello World </h2>;
  }
  return { gamesList };
};

export default ListGame;
