var io = require('socket.io-client');
var Bot = require('./bot');
var global = require('./global');

var socket;
var reason;

var debug = function(args) {
    if (console && console.log) {
        console.log(args);
    }
};

function startGame() {
    const type = 'player';

    global.playerName = 'bot';
    global.playerType = type;

    if (!socket) {
        socket = io('http://localhost:3000/', {query: 'type=' + type});
        setupSocket(socket);
    }
    socket.emit('respawn');

    bot = new Bot({
        feed: function() {
            socket.emit('1');
        },
        split: function() {
            socket.emit('2');
        },
    });
}

startGame();
setInterval(function() {
    if(global.died) {
        socket.emit('respawn');
    } else {
        gameLoop();
    }
}, 1000 / 5);

// Checks if the nick chosen contains valid alphanumeric characters (and underscores).
function validNick() {
    var regex = /^\w*$/;
    debug('Regex Test', regex.exec(playerNameInput.value));
    return regex.exec(playerNameInput.value) !== null;
}

var player = {
    id: -1,
    x: global.screenWidth / 2,
    y: global.screenHeight / 2,
    screenWidth: global.screenWidth,
    screenHeight: global.screenHeight,
    target: {x: global.screenWidth / 2, y: global.screenHeight / 2}
};
global.player = player;

var foods = [];
var viruses = [];
var fireFood = [];
var users = [];
var leaderboard = [];
var target = {x: player.x, y: player.y};
global.target = target;

// socket stuff.
function setupSocket(socket) {
    // Handle ping.
    socket.on('pongcheck', function () {
        var latency = Date.now() - global.startPingTime;
        debug('Latency: ' + latency + 'ms');
    });

    // Handle error.
    socket.on('connect_failed', function () {
        socket.close();
        global.disconnected = true;
    });

    socket.on('disconnect', function () {
        socket.close();
        global.disconnected = true;
    });

    // Handle connection.
    socket.on('welcome', function (playerSettings) {
        player = playerSettings;
        player.name = global.playerName;
        player.screenWidth = global.screenWidth;
        player.screenHeight = global.screenHeight;
        player.target = global.target;
        global.player = player;
        socket.emit('gotit', player);
        global.gameStart = true;
        debug('Game started at: ' + global.gameStart);
    });

    socket.on('gameSetup', function(data) {
        global.gameWidth = data.gameWidth;
        global.gameHeight = data.gameHeight;
        resize();
    });

    socket.on('playerDied', function (data) {
        console.log('{GAME} - <b>' + (data.name.length < 1 ? 'An unnamed cell' : data.name) + '</b> was eaten.');
    });

    socket.on('playerDisconnect', function (data) {
        console.log('{GAME} - <b>' + (data.name.length < 1 ? 'An unnamed cell' : data.name) + '</b> disconnected.');
    });

    socket.on('playerJoin', function (data) {
        console.log('{GAME} - <b>' + (data.name.length < 1 ? 'An unnamed cell' : data.name) + '</b> joined.');
    });

    socket.on('leaderboard', function (data) {
    });

    socket.on('serverMSG', function (data) {
        console.log(data);
    });

    // Chat.
    socket.on('serverSendPlayerChat', function (data) {
        console.log(data.sender + ': ' + data.message);
    });

    // Handle movement.
    socket.on('serverTellPlayerMove', function (userData, foodsList, massList, virusList) {
        bot.onServerTellPlayerMove(userData, foodsList, massList, virusList);
    });

    // Death.
    socket.on('RIP', function () {
        global.gameStart = false;
        global.died = true;
        console.log('RIP');
    });

    socket.on('kick', function (data) {
        global.gameStart = false;
        reason = data;
        global.kicked = true;
        socket.close();
    });

    socket.on('virusSplit', function (virusCell) {
        socket.emit('2', virusCell);
    });
}

function valueInRange(min, max, value) {
    return Math.min(max, Math.max(min, value));
}

function gameLoop() {
    if (global.died) {
        console.log('You died!');
    }
    else if (!global.disconnected) {
        if (global.gameStart) {
            var orderMass = [];
            for(var i=0; i<users.length; i++) {
                for(var j=0; j<users[i].cells.length; j++) {
                    orderMass.push({
                        nCell: i,
                        nDiv: j,
                        mass: users[i].cells[j].mass
                    });
                }
            }
            orderMass.sort(function(obj1, obj2) {
                return obj1.mass - obj2.mass;
            });

            //drawPlayers(orderMass);
            console.log(bot.target);
            socket.emit('0', bot.target); // playerSendTarget "Heartbeat".
        } else {
            console.log('Game Over!', global.screenWidth / 2, global.screenHeight / 2);
        }
    } else {
        if (global.kicked) {
            if (reason !== '') {
                console.log('You were kicked for:');
                console.log(reason);
            }
            else {
                console.log('You were kicked!');
            }
        }
        else {
            console.log('Disconnected!');
        }
    }
}

function resize() {
    if (!socket) return;
    socket.emit('windowResized', { screenWidth: global.screenWidth, screenHeight: global.screenHeight });
}
