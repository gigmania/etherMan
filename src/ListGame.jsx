import React from 'react';
import { Link } from 'react-router-dom';

const ListGame = props => {
  let frontEndId;
  let challenger = 'KeeneyBixby';
  let { userName, word, wager, tries } = props;
  console.log('i am the props ---> ', props);

  let startLiveGame = () => {
    let liveGameInstance;
    let account = props.accounts[9];
    let uniqGameString = word + wager + userName + tries + challenger;
    frontEndId = userName + new Date().getTime() + challenger;
    // props.liveGameContract
    //   .deployed()
    //   .then(function(instance) {
    //     liveGameInstance = instance;
    //     return liveGameInstance.startLiveGame(word, wager, tries, uniqGameString, userName, challenger, {
    //       from: account,
    //       gas: 3000000
    //     });
    //   })
    //   .then(function(result) {
    //     console.log('i am the result ---> ', result);
    //   })
    //   .catch(function(err) {
    //     console.log(err);
    //   });
  };
  return (
    <div className="pending-game">
      <div className="game-attr user">
        <b> {userName} </b>
      </div>
      <div className="game-attr letters">
        <b> {word.length} </b>
      </div>
      <div className="game-attr wager">
        <b> {wager} </b>
      </div>
      <div className="game-attr tries">
        <b> {tries} </b>
      </div>
      <div className="game-attr play-game">
        <Link
          className="game-route-btn"
          onClick={startLiveGame}
          to={`/live-game/${userName}${new Date().getTime()}${challenger}`}
        >
          <button className="play-game__btn">PLAY</button>
        </Link>
      </div>
    </div>
  );
};

export default ListGame;
