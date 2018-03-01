import React from 'react';
import { Link } from 'react-router-dom';

import './listGame.css';

const ListGame = props => {
  let frontEndId;
  let challenger = 'KeeneyBixby';
  let { userName, wordLength, wager, tries, userWord, gameId } = props;
  // console.log('i am the props ---> ', props);
  // console.log(typeof gameId);

  let startLiveGame = () => {
    let hangmanInstance;
    let account = props.accounts[5];
    frontEndId = `${tries}:${userName}${new Date().getTime()}${challenger}:000$${wager}`;
    props.hangmanContract
      .deployed()
      .then(function(instance) {
        hangmanInstance = instance;
        return hangmanInstance.commenceLiveGame(challenger, gameId, frontEndId, wordLength, {
          from: account,
          gas: 3000000
        });
      })
      .then(function(result) {
        console.log('i am the result ---> ', result);
      })
      .catch(function(err) {
        console.log(err);
      });
  };
  return (
    <div className="pending-game">
      <div className="game-attr user">
        <b> {userName} </b>
      </div>
      <div className="game-attr letters">
        <b> {wordLength} </b>
      </div>
      <div className="game-attr wager">
        <b> {wager} </b>
      </div>
      <div className="game-attr tries">
        <b> {tries} </b>
      </div>
      <div className="game-attr play-game">
        <Link
          className="react-link-btn"
          onClick={startLiveGame}
          to={`/live-game/${tries}:${userName}${new Date().getTime()}${challenger}:000$${wager}`}
        >
          <button className="play-game__btn">PLAY</button>
        </Link>
      </div>
    </div>
  );
};

export default ListGame;
