let express = require('express');
let router = express.Router();
let session = require('express-session');
let passport = require('passport');
let multer = require('multer');
let aws = require('aws-sdk');
let multers3 = require('multer-s3');
aws.config.loadFromPath('./S3/config.json');
let s3 = new aws.S3();
let fs = require('fs');
let SequelizeStore = require('connect-session-sequelize')(session.Store);

let upload = multer({
    storage: multers3({
        s3: s3,
        bucket: 'igclonev2',
        metadata: function (req, file, cb) {
            cb(null, { fieldName: file.fieldname });
        },
        key: function (req, file, cb) {
            cb(null, Date.now().toString())
        }
    })
});

const Sequelize = require('sequelize');
const sequelize = new Sequelize('postgres', 'postgres', 'nppsjuoll', {
    host: 'localhost',
    port: 5432,
    dialect: 'postgres'
});

sequelize
    .authenticate()
    .then(() => {
        console.log('Connection has been established successfully.');
    })
    .catch(err => {
        console.error('Unable to connect to the database:', err);
    });

let Ideas = require('./models/ideas.js')(sequelize, Sequelize);
let Comments = require('./models/comments.js')(sequelize, Sequelize);
let Likes = require('./models/likes.js')(sequelize, Sequelize);
let Users = require('./models/users.js')(sequelize, Sequelize);

Ideas.hasMany(Comments, { foreignKey: "postID" });
Ideas.hasMany(Likes, { foreignKey: "commentID" });
Comments.belongsTo(Ideas, { foreignKey: "postID" });
Ideas.belongsTo(Users, { foreignKey: 'userName' });
Likes.belongsTo(Users, { foreignKey: "userName" });
Comments.belongsTo(Users, { foreignKey: 'userName' })

require('./config/config')
require('./strategies/passport-local.js')(passport);


let bodyParser = require('body-parser');
let createError = require('http-errors');
let path = require('path');
let cookieParser = require('cookie-parser');
let logger = require('morgan');
//let pgSession = require('connect-pg-simple')(session);

//middlewares
router.use(bodyParser());
router.use(logger('dev'));
router.use(express.json());
router.use(express.urlencoded({ extended: false }));
router.use(cookieParser());
router.use(express.static(path.join(__dirname, 'public')));

let myStore = new SequelizeStore({
    db: sequelize
});
//Session Store
router.use(session({
    store: myStore,
    key: 'user_sid',
    secret: 'PixeltheShieldMaiden',
    resave: false,
    saveUninitialized: true,
    cookie: {
        expires: 3600000
    }
}));

router.use(passport.initialize());
router.use(passport.session());

myStore.sync();

function compareValues(key, order = 'asc') {
    return function (a, b) {
        if (!a.hasOwnProperty(key) || !b.hasOwnProperty(key)) {
            // property doesn't exist on either object
            return 0;
        }

        const letA = (typeof a[key] === 'string') ?
            a[key].toUpperCase() : a[key];
        const letB = (typeof b[key] === 'string') ?
            b[key].toUpperCase() : b[key];
        let comparison = 0;
        if (letA > letB) {
            comparison = 1;
        } else if (letA < letB) {
            comparison = -1;
        }
        return (
            (order == 'desc') ? (comparison * -1) : comparison
        );
    };
};

router.get('/', (req, res) => {
    res.render('home');
});

router.get('/signup', (req, res) => {
    res.render('signup');
});

router.get('/signuperror', (req, res) => {
    res.render('signuperror');
});

router.post('/signup', passport.authenticate('local-signup', { successRedirect: '/login', failureRedirect: '/signuperror' }), (req, res) => {
    res.redirect('/login');
});

router.get('/login', (req, res) => {
    res.render('login');
});

router.get('/loginerror', (req, res) => {
    res.render('loginerror');
});

/*router.post('/login', function(req, res, next) {
    //console.log('isAUTHENTICATED is: ', req.isAuthenticated());
    passport.authenticate('local-login', function(err, user) {
      if (err) { 
          return next(err); 
      };
      if (!user) { 
          return res.redirect('/loginerror'); 
      };
      userName = user.username; 
      return res.redirect('/home');

    })(req, res, next);
});*/

router.post('/login', passport.authenticate('local-login', { successRedirect: '/home', failureRedirect: '/loginerror' }), (req, res) => {
    res.redirect('/login');
})

router.get('/faq', (req, res) => {
    res.render('faq')
});

function checkAuthentication() {
    return (req, res, next) => {
        if (req.isAuthenticated()) return next();

        res.redirect('/login');
    }
};

router.get('/home', checkAuthentication(), (req, res) => {
    userName = req.user.username
    console.log(userName);
    console.log('THIS IS REQ.USER', req.user);
    console.log(req.isAuthenticated());
    Ideas.findAll({
        include: [
            {
                model: Comments
            },
            {
                model: Likes
            }
        ]
    }).then(ideas => {
        const resObj = ideas.map(idea => {
            return Object.assign(
                {},
                {
                    ideas_id: idea.id,
                    ideas_title: idea.title,
                    ideas_description: idea.description,
                    comments: idea.Comments.map(comment => {
                        return Object.assign(
                            {},
                            {
                                comment_id: comment.id,
                                comment_comments: comment.comments,
                                comment_from_userName: comment.userName
                            }
                        )
                    }),
                    likes: idea.Likes.map(likes => {
                        return Object.assign(
                            {},
                            {
                                likes_like: likes.id,
                                user_who_liked: likes.userName
                            }
                        )
                    })
                }
            );
        });
        let sortedObj = resObj.sort(compareValues("ideas_id"))
        //console.log(sortedObj);
        res.render('index', { title: "Instagram", ideas: sortedObj })
    });
});

router.post('/home', upload.single('imageUpload'), (req, res) => {
    console.log(req)
    Ideas.create({
        title: req.body.title,
        description: req.file.key,
        userName: userName
    }).then(() => {
        res.redirect('/home');
    });
});

router.post('/comments', (req, res) => {
    Comments.sync()
        .then(() => {
            return Comments.create({
                comments: req.body.comment,
                postID: req.body.postID,
                userName: userName
            })
        })
        .then(() => {
            res.redirect('/home')
        });
});

router.post('/likes', (req, res) => {
    Likes.findAll({
        where: {
            userName: userName,
            commentID: req.body.postID
        }
    }).then(likes => {
        if (likes.length == 0) {
            return Likes.create({
                likes: 1,
                commentID: req.body.postID,
                userName: userName
            }).then(() => {
                res.redirect('/home')
            })
        }
        else {
            Likes.destroy({
                where: {
                    userName: userName,
                    commentID: req.body.postID
                }
            }).then(() => {
                res.redirect('/home')
            })
        }
    });
});

router.get('/profile', (req, res) => {
    Ideas.findAll({
        where: {
            userName: userName
        }
    })
        .then(posts => {
            res.render('profile', { posts: posts })
        });
});

router.post('/delete', (req, res) => {
    Ideas.destroy({
        where: {
            id: req.body.postID
        }
    }).then(() => {
        console.log('successfully deleted instance..');
        res.redirect('/profile')
    });
});

module.exports = router; 