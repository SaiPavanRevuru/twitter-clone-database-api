const express = require("express");
const app = express();
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is running at http:/localhost:3000/");
    });
  } catch (e) {
    console.log(e.message);
  }
};

initializeDBAndServer();

function validatePassword(password) {
  return password.length > 6;
}

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    const createUserQuery = `
        INSERT INTO user (name, username, password, gender)
        VALUES (
            '${name}', '${username}', '${hashedPassword}', '${gender}'
        );
      `;
    if (validatePassword(password)) {
      await db.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const jwtToken = jwt.sign(dbUser, "VIBHA");
      response.send({ jwtToken: jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

const authenticateToken = (request, response, next) => {
  const { tweet } = request.body;
  const { tweetId } = request.params;
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "VIBHA", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.payload = payload;
        request.tweetId = tweetId;
        request.tweet = tweet;
        next();
      }
    });
  }
};

app.get("/user/tweets/feed", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  const getTweetsFeedQuery = `
        SELECT 
            username,
            tweet,
            date_time AS dateTime
        FROM 
            follower INNER JOIN tweet ON follower.following_user_id = tweet.user_id INNER JOIN user ON user.user_id = follower.following_user_id
        WHERE 
            follower.follower_user_id = ${user_id}
        ORDER BY
            date_time DESC
        LIMIT 4    
            ;`;

  const tweetFeedArray = await db.all(getTweetsFeedQuery);
  response.send(tweetFeedArray);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  const getUserFollowingQuery = `
    SELECT name FROM 
    user INNER JOIN follower ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id = ${user_id};
  `;
  const getFollowingArray = await db.all(getUserFollowingQuery);
  response.send(getFollowingArray);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  const getFollowersQuery = `
  SELECT name 
  FROM
  user INNER JOIN follower ON user.user_id = follower.follower_user_id
  WHERE follower.following_user_id = ${user_id}; 
  `;
  const getFollowers = await db.all(getFollowersQuery);
  response.send(getFollowers);
});

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  const getTweetsQuery = `
    SELECT 
        tweet.tweet AS tweet, 
        COUNT(DISTINCT(like.like_id)) AS likes, 
        COUNT(DISTINCT(reply.reply_id)) AS replies, 
        tweet.date_time AS dateTime 
    FROM 
        user INNER JOIN tweet ON user.user_id = tweet.user_id INNER JOIN like ON like.tweet_id = tweet.tweet_id INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
    WHERE 
        user.user_id = ${user_id}
    GROUP BY 
        tweet.tweet_id;
  `;
  const getTweets = await db.all(getTweetsQuery);
  response.send(getTweets);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  const { tweetId } = request;

  const tweetsQuery = `
    SELECT * FROM 
        tweet
    WHERE 
        tweet_id = ${tweetId};
  `;
  const getTweets = await db.get(tweetsQuery);

  const getUserFollowerQuery = `
    SELECT * FROM 
        follower INNER JOIN user ON follower.following_user_id = user.user_id
    WHERE 
        follower.follower_user_id = ${user_id};
  `;
  const getUserFollowers = await db.all(getUserFollowerQuery);

  if (
    getUserFollowers.some(
      (item) => item.following_user_id === getTweets.user_id
    )
  ) {
    const getTweetsOfFollowerQuery = `
        SELECT 
            tweet.tweet AS tweet,
            COUNT(DISTINCT(like.like_id)) AS likes,
            COUNT(DISTINCT(reply.reply_id)) AS replies,
            tweet.date_time AS dateTime
        FROM 
            tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
        WHERE 
            tweet.tweet_id = ${tweetId} AND tweet.user_id = ${getUserFollowers[0].user_id};
      `;
    const getTweetsDetailsArray = await db.get(getTweetsOfFollowerQuery);
    response.send(getTweetsDetailsArray);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get(
  "/tweets/:tweetId/likes",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request;
    const { payload } = request;
    const { user_id, name, username, gender } = payload;
    const getLikedUsersQuery = `
            SELECT 
               *
            FROM 
                follower INNER JOIN tweet ON tweet.user_id = follower.following_user_id INNER JOIN like ON like.tweet_id = tweet.tweet_id 
                INNER JOIN user ON user.user_id = like.user_id
            WHERE 
            tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${user_id}
    ;`;
    const likedUsers = await db.all(getLikedUsersQuery);
    if (likedUsers.length !== 0) {
      let likes = [];
      const getNamesArray = (likedUsers) => {
        for (let item of likedUsers) {
          likes.push(item.username);
        }
      };
      getNamesArray(likedUsers);
      response.send({ likes });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request;
    const { payload } = request;
    const { user_id, name, username, gender } = payload;
    const getRepliedUsersQuery = `
        SELECT * FROM 
            follower INNER JOIN tweet ON tweet.user_id = follower.following_user_id INNER JOIN reply ON reply.tweet_id = tweet.tweet_id
            INNER JOIN user ON user.user_id = reply.user_id
        WHERE 
            tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${user_id};
    `;
    const repliedUsers = await db.all(getRepliedUsersQuery);
    if (repliedUsers.length !== 0) {
      let replies = [];
      const getDetailsArray = (repliedUsers) => {
        for (let item of repliedUsers) {
          let object = {
            name: item.name,
            reply: item.reply,
          };
          replies.push(object);
        }
      };

      getDetailsArray(repliedUsers);
      response.send({ replies });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request;
  const { tweetId } = request;
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  const createTweetQuery = `
    INSERT INTO 
        tweet (tweet, user_id) 
    VALUES (
        '${tweet}',
        '${user_id}'
    );
  `;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request;
    const { payload } = request;
    const { user_id, name, username, gender } = payload;
    const getUserQuery = `
        SELECT * FROM 
             tweet 
        WHERE 
            tweet.user_id = ${user_id} AND tweet.tweet_id = ${tweetId};
    `;
    const getUserTweet = await db.all(getUserQuery);

    if (getUserTweet.length === 0) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `
            DELETE FROM tweet
                WHERE tweet.user_id = ${user_id} AND tweet.tweet_id = ${tweetId};
        `;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
