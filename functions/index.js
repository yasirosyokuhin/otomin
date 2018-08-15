'use strict';

process.env.DEBUG = 'actions-on-google:*';
const { DialogflowApp } = require('actions-on-google');
const functions = require('firebase-functions');
// var datastore = require('./datastore');
const admin = require('firebase-admin');
// Get a database reference to our posts
admin.initializeApp(functions.config().firebase);
const db = admin.database();

const googleAssistantRequest = 'google'; // Constant to identify Google Assistant requests
const audioUrl = `https://dq310.com/imgwk/audio/`;
const quizMax = 5;
const hardLevel = 5;

function update_user_ok(session_id, ok) {
  let ref = db.ref('user');
  const updatekey_acctive_flg = session_id + "/acttive_flg";
  const updatekey_correct_flg = session_id + "/correct_flg";

  // 結果の更新
  if (ok == 1) {
    ref.update({
      [updatekey_acctive_flg]  : "0",
      [updatekey_correct_flg]  : "1"
    });
  } else {
    ref.update({
      [updatekey_acctive_flg]  : "0"
    });
  }
}

function checkQuiz(sessionId, app, answer) {
  let ref = db.ref('user');
  ref.orderByChild('session_id').equalTo(sessionId).once('value', snapshot => {
    var ok = 0;
    var updatekey = null;
    var total_count = 0;
    var total_ok = 0;
    var userText = "";

    // 選択済みのクイズがある前提で処理。 全体の合否集計も一緒に実施
    snapshot.forEach(function(child) {
      var item = child.val();
      if (item["acttive_flg"] == 1) {
        if (item["correct_word_1"] == answer|| item["correct_word_2"] == answer || item["correct_word_3"] == answer) {
          // 正解
          ok = 1;
          total_ok++;
          userText += `<audio src="${audioUrl}/namisound/ok_chime.mp3"></audio>正解。<break time="1s"></break>`;
        } else {
          // 外れ。正しい答えを保持
          userText += `<audio src="${audioUrl}/namisound/ng_chime.mp3"></audio>残念。答えは${item["correct_word_1"]}でした。<break time="1s"></break>`;
        }
        updatekey = child.key;
      }
      if (item["correct_flg"] == 1) {
        total_ok++;
      }
      total_count++;
    });
    // レコードがない場合はエラー（ありえない）
    if (updatekey == null) app.tell("エラーが発生しました。最初からお願いします");
    // 合否更新
    update_user_ok(updatekey, ok);
    // 終了判定
    if (total_count >= quizMax) {
      var finish_sound;
      if (total_ok == quizMax) {
        finish_sound = `<audio src="${audioUrl}/namisound/trumpet2.mp3"></audio>`;
      } else if (total_ok >= (quizMax/2)) {
        finish_sound = `<audio src="${audioUrl}/namisound/trumpet1.mp3"></audio>`;
      } else {
        finish_sound = `<audio src="${audioUrl}/namisound/flash1.mp3"></audio>`;
      }
      //終了処理
      deleteUser(sessionId);
      app.ask(`<speak>${userText}結果発表<break time="0.5s"></break>${finish_sound}${total_count}問中${total_ok}もん正解でした。<break time="0.5s"></break>再度プレイする場合は、開始と言ってください。</speak>`);
    } else {
      // 次の出題
      questionQuiz(sessionId, app, userText);
    }
  });
}

function selectQuiz(quiz_master, quiz_user) {
  var taget_quiz_list = [];
  for(let i = 0; i < quiz_master.length; i++) {
    var dep = 0;
    for(let j = 0; j < quiz_user.length; j++) {
      if (quiz_master[i]["key"] == quiz_user[j]["quiz_no"]) {
        dep = 1;
        break;
      }
    }
    if (dep == 0) {
      taget_quiz_list.push(quiz_master[i]);
    }
  }
  // ランダムで１問を決定
  var select_quiz = taget_quiz_list[ Math.floor( Math.random() * taget_quiz_list.length ) ] ;
  // 出題番号を設定
  select_quiz["next_number"] = quiz_user.length + 1;
  return select_quiz;
}

function pushUser(session_id, select_item) {
  const pushRef = admin.database().ref("/user").push();
  pushRef.set({
    acttive_flg: 1,
    correct_flg :0,
    ng_flg:0,
    quiz_no:select_item["key"],
    session_id:session_id,
    correct_word_1:select_item["correct_word_1"],
    correct_word_2:select_item["correct_word_2"],
    correct_word_3:select_item["correct_word_3"],
    updt_ymd:Number(getNowYMD())
  }, error => {
    if (error) {
      return;
    } else {
      return;
    }
  });
}

function getNowYMD(){
  var dt = new Date();
  var y = dt.getFullYear();
  var m = ("00" + (dt.getMonth()+1)).slice(-2);
  var d = ("00" + dt.getDate()).slice(-2);
  var result = y  + m  + d;
  return result;
}

function deleteUser(sessionId) {
  let ref = db.ref('user');
  ref.orderByChild('session_id').equalTo(sessionId).once('value', snapshot => {
    let updates = {};
    snapshot.forEach(child => updates[child.key] = null);
    ref.update(updates);
  });
  return;
}

function deleteOldUser() {
  let ref = db.ref('user');
  var deleteDay = Number(getNowYMD()) -2;
  ref.orderByChild('updt_ymd').endAt(deleteDay).once('value', snapshot => {
    let updates = {};
    snapshot.forEach(child => updates[child.key] = null);
    ref.update(updates);
  });
  return;
}

function questionQuiz(sessionId, app, userText) {
  let ref_quiz = db.ref('quiz');
  let ref_user = db.ref('user');

  //　クイズマスタを取得
  ref_quiz.once("value").then(snapshot => {
    var quiz_master = [];
    var quiz_user = [];
    snapshot.forEach(function(data) {
      var item = data.val();
      item.key = data.key;
      quiz_master.push(item);
    });
    // 現在出題中のクイズを取得
    ref_user.orderByChild('session_id').equalTo(sessionId).once('value', snapshot2 => {
      snapshot2.forEach(function(data) {
        var item = data.val();
        item.key = data.key;
        quiz_user.push(item);
      });
      var select_quiz = selectQuiz(quiz_master, quiz_user);
      pushUser(sessionId, select_quiz);
      const audioFile = audioUrl + select_quiz["category"] + "/" + select_quiz["file"];
      var hardSound = "";
      if (select_quiz["level"] >= hardLevel) {
          hardSound = `<audio src="${audioUrl}/namisound/eye-shine1.mp3"></audio>`;
      }
      // クイズ返却
      const speak = `<speak>${userText}第${select_quiz["next_number"]}問。${hardSound}<break time="1s"></break>この音なーんだ？<break time="1s"></break><audio src="${audioFile}"></audio>わかるかな？</speak>`;
      // sendGoogleResponse(speak); // Send simple response to user
      app.setContext("question",10,{});
      app.ask(speak); // Send response to Dialogflow and Google Assistant
    });
  });
}

exports.quizAction = functions.https.onRequest((request, response) => {
  const app = new DialogflowApp({request, response});
  const action = request.body.result.action;
  const parameters = request.body.result.parameters; // https://dialogflow.com/docs/actions-and-parameters
  // Contexts are objects used to track and store conversation state
  const inputContexts = request.body.result.contexts; // https://dialogflow.com/docs/contexts
  const sessionId = request.body.sessionId;
  // Get the request source (Google Assistant, Slack, API, etc) and initialize DialogflowApp
  const requestSource = (request.body.originalRequest) ? request.body.originalRequest.source : undefined;
  const answer = request.body.result.parameters.quiz_answer_list;

  switch (action) {
    case 'start_quiz':
      return startQuiz(sessionId, app);
      break;
    case 'answer_quiz':
      return answerQuiz(sessionId, app, answer);
      break;
  }
  // クイズ開始
  function startQuiz(sessionId, app) {
    // ユーザテーブルを初期化する
    deleteUser(sessionId);
    // クイズ出題
    questionQuiz(sessionId,app,"");
  }
  // 答え合わせ
  function answerQuiz(sessionId, app, answer) {
    checkQuiz(sessionId, app, answer);
  }
});

// old data delete job
exports.deleteUserInfo = functions.https.onRequest((request, response) => {
  deleteOldUser();
  response.status(200).json("OK").end();
});

// mp3 setting check
exports.chkMp3File = functions.https.onRequest((request, response) => {
  let ref_quiz = db.ref('quiz');
  var str;
  //　クイズマスタを取得
  ref_quiz.once("value").then(snapshot => {
    snapshot.forEach(function(data) {
      var item = data.val();
      str += audioUrl + item["category"] +"/"+ item["file"];
    });
  });
  response.status(200).json("OK").end();
});
