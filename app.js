//To read in environment variable used for database access and Fitbit authenitcation
require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

/** Used to make API calls */
const unirest = require('unirest');

//for modeling users and connecting to db
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const cors = require('cors');
const mongoose = require('mongoose');
const errorHandler = require('errorhandler');

//original server and authentication requires for backend and authentication
const express = require('express');
const passport = require('passport');
var FitbitStrategy = require( 'passport-fitbit-oauth2' ).FitbitOAuth2Strategy;;

var trustProxy = false;
if (process.env.DYNO) {
  // Apps on heroku are behind a trusted proxy
  trustProxy = true;
}


// Configure the Fitbit strategy for use by Passport.
var accessTokenTemp = null;
var userid = null;
passport.use(new FitbitStrategy({
    clientID: process.env['FITBIT_CONSUMER_KEY'],
    clientSecret: process.env['FITBIT_CONSUMER_SECRET'],
    callbackURL: "https://blooming-sands-88868.herokuapp.com/auth/fitbit/callback",
  },
  function(accessToken, refreshToken, profile, done) {
    {
        //makes access token available to client after authentication
        console.log(accessToken);
        accessTokenTemp = accessToken;
        done(null, profile);
    }
  }
));

// Configure Passport authenticated session persistence.
passport.serializeUser(function(user, cb) {
  cb(null, user);
});

passport.deserializeUser(function(obj, cb) {
  cb(null, obj);
});

//import mongoclient to connect with db
const {MongoClient} = require('mongodb');

//async functions for mongoDB - used during data insertion, updates and access
//list databases
async function listDatabases(client){
    databasesList = await client.db().admin().listDatabases();
    console.log("Databases:");
    databasesList.databases.forEach(db => console.log(` - ${db.name}`));
};
//create a new listing
async function createListing(client, newListing){
    const result = await client.db("mhealth").collection("users").insertOne(newListing);
    console.log(`New listing created with the following id: ${result.insertedId}`);
}
//create new Survey response
async function createSurvey(client, form, user){
  const result = await client.db("mhealth").collection("users").update({"_id": user.id}, {$push: {"entries":form}});
  //insertOne(form);
  console.log(`New survey created with the following timestamp: ${form.creationDate}`);
}
//retrieve survey entries from DB
async function retrieveEntries(client, user, entries){
  const result = await client.db("mhealth").collection("users").findOne({_id:user.id});
  // const result =
  entries = JSON.stringify(result);
  console.log(entries.entries);
  // res.send(entries);
}

//main function to connect to db cluster
async function main(user,form,retrieve){
    //connection URI
    const uri = process.env['dburi'];
    //create instance of mongo client
    const client = new MongoClient(uri, {useUnifiedTopology: true});
    try {
        // Connect to the MongoDB cluster
        await client.connect();
        // Create a single new listing
        if (!form) {
          if (!retrieve) {
            console.log("creating a listing");
            await createListing(client,
            {
                provider: user.provider,
                _id: user.id,
                displayName: user.displayName,
                entries: []
            });
            userid = user.id;
          }
          console.log("retrieving entries");
          await retrieveEntries(client,user,retrieve);
        } else {
            console.log("submitting a form");
            form['creationDate'] = new Date();
            await createSurvey(client, form, user);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}
// main().catch(console.error);

// Create a new Express application.
var app = express();

// Configure view engine to render EJS templates.
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

// Use application-level middleware for common functionality, including
// logging, parsing, and session handling.
app.use(cors());
app.use(require('morgan')('combined'));
app.use(require('body-parser').urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(require('express-session')({ secret: 'keyboard cat', resave: true, saveUninitialized: true }));

//bootstrap and jquerystyling
app.use(
  "/css",
  express.static(path.join(__dirname, "node_modules/bootstrap/dist/css"))
)
app.use(
  "/js",
  express.static(path.join(__dirname, "node_modules/bootstrap/dist/js"))
)
app.use("/js", express.static(path.join(__dirname, "node_modules/jquery/dist")))

// Initialize Passport and and create new session.
app.use(passport.initialize());
app.use(passport.session({
    resave: false,
    saveUninitialized: true
}));

//login page
app.get('/login',
  function(req, res){
    res.render('login');
  });

//fitbit authentication
app.get('/auth/fitbit',
    passport.authenticate('fitbit', { scope: ['activity','sleep','weight','location','profile'] }
  ));

app.get( '/auth/fitbit/callback',
  passport.authenticate( 'fitbit', { failureRedirect: '/error' }),
  //possibly the place to integrate find user() from db - via passport-http-bearer ex.
  function(req,res) {
    res.redirect('/');
    // res.json({ user: req.user })
  });

//error page
app.get('/error', (request, result) =>
{
    result.write("Error authenticating with Fitbit API");
    result.end();
});

//home page
app.get('/',
  require('connect-ensure-login').ensureLoggedIn(),
  function(req, res){
    if (req.user)
      main(req.user,null,null).catch(console.error);
    res.render('home', { user: req.user });
  });

//profile page
app.get('/profile',
  require('connect-ensure-login').ensureLoggedIn(),
  function(req, res){
    res.render('profile', { user: req.user });
  });


//queryAPI function to display JSON from fitbit API calls
const queryAPI = function(result, path)
{
    return new Promise((resolve, reject)=>
    {
        if(accessTokenTemp == null)
        {
            result.redirect('/auth/fitbit');
            resolve(false);
        }
        unirest.get(path)
            .headers({'Accept': 'application/json', 'Content-Type': 'application/json', Authorization: "Bearer " +  accessTokenTemp})
            .end(function (response)
            {
                if(response.hasOwnProperty("success") && response.success == false)
                {
                    result.redirect('/auth/fitbit');
                    resolve(false);
                }
                resolve(response.body);
            });
    });
};

//steps page
app.get('/steps', (request, result)=>
{
    queryAPI(result, 'https://api.fitbit.com/1/user/-/activities/tracker/steps/date/today/1m.json').then((data)=>
    {
        if(data != false)
        {
            //package relevant data into Yesterday's Daily Percent Change and info in JSON
            const info = JSON.stringify(data);
            let steps = data['activities-tracker-steps'];
            let array = [['Date','Step Count']];
            steps.forEach(element => array.push([element['dateTime'],Number(element['value'])]));
            request.user.array = array;
            console.log(array);
            let length = data['activities-tracker-steps'].length;
            let yesterday = data['activities-tracker-steps'][length-2];
            let daybefore = data['activities-tracker-steps'][length-3];
            let laststep = yesterday['value'];
            let secondstep = daybefore['value'];
            let full = (laststep - secondstep)/secondstep*100;
            const ydc = full.toFixed(2);

            result.render('steps', { info: info, user: request.user, ydc: ydc, steps: steps, array: request.user.array });
            result.end();
        }
        else
        {
            console.log("Validating with API");
        }
    });
});

//survey page
app.get('/survey',
  require('connect-ensure-login').ensureLoggedIn(),
  function(req, res) {
    res.render('survey',{ user: req.user });
  });

//survey EMA form post
app.post('/survey', function (req, res) {
  require('connect-ensure-login').ensureLoggedIn(),
    main(req.user,req.body,null).catch(console.error);
    res.render('survey', {submitted:req.body});
});

//entries page
  app.get('/entries', function(req, res) {
    //connection URI
    const uri = process.env['dburi'];
    //create instance of mongo client
    const mongoclient = new MongoClient(uri, {useUnifiedTopology: true});
    // Open the connection to the server
    require('connect-ensure-login').ensureLoggedIn(),
    mongoclient.connect(function(err, mongoclient) {
      if (err) throw err;
      if (req.user) {
        const collection = mongoclient.db("mhealth").collection("users").findOne({_id:req.user.id},
        function(err,result){
          if (err) throw err;
          //package recent EMA responses
          let array = result;
          console.log(array);
          const entries = array['entries'];
          const info = JSON.stringify(array[0]);
          let values = {};
          values.generic = ['Neutral','Positive','Negative'];
          values.assess = ['I am satisfied with my activity.','I feel okay about my activity.','I am not satisfied with my activity.'];
          values.confirm = ['Yesterday I was more active than the day before.', 'Yesterday I was about as active as the day before.', 'Yesterday I was less active than the day before.'];
          values.goal = ['Be more active than yesterday', 'Be about as active as yesterday.','Be less active about yesterday.'];
          // const info = JSON.parse(result);
          res.render('entries', { entries: entries, user: req.user, values: values });
          // console.log(array['entries']);
          mongoclient.close();
        })
      }
    })
  });

//logout page
app.get('/logout',
  function(req, res){
    req.session.destroy(function (err) {
      res.redirect('/');
    });
  });

//port for server
app.listen(process.env.PORT || 3000);
