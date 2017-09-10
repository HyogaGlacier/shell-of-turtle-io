/*jslint bitwise: true, node: true */
'use strict';

var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var SAT = require('sat');
var sql = require("mysql");

// Import game settings.
var c = require('../../config.json');

// Import utilities.
var util = require('./lib/util');

// Import quadtree.
var quadtree = require('simple-quadtree');

//call sqlinfo
var s = c.sqlinfo;

var tree = quadtree(0, 0, c.gameWidth, c.gameHeight);

var users = [];
var massFood = [];
var food = [];
var shells = [];
var virus = [];
// -----
var shells = [];
var sockets = {};

var leaderboard = [];
var leaderboardChanged = false;

var V = SAT.Vector;
var C = SAT.Circle;

if (s.host !== "DEFAULT") {
    var pool = sql.createConnection({
        host: s.host,
        user: s.user,
        password: s.password,
        database: s.database
    });

    //log sql errors
    pool.connect(function(err) {
        if (err) {
            console.log(err);
        }
    });
}

var initMassLog = util.log(c.defaultPlayerMass, c.slowBase);

app.use(express.static(__dirname + '/../client'));

function addFood(toAdd) {
    var radius = util.massToRadius(c.foodMass);
    while (toAdd--) {
        var position = c.foodUniformDisposition ? util.uniformPosition(food, radius) : util.randomPosition(radius);
        food.push({
            // Make IDs unique.
            id: ((new Date()).getTime() + '' + food.length) >>> 0,
            x: position.x,
            y: position.y,
            radius: radius,
            mass: Math.random() + 2,
            hue: Math.round(Math.random() * 360)
        });
    }
}

// -----
function breakFood(breakUser) {
    var radius = util.massToRadius(c.foodMass);
    breakUser.mass *= 0.8;
    while (breakUser.mass > 0) {
        var putFoodMass = Math.min(25 * Math.random() + 5, breakUser.mass);
        var targetArg = Math.random();
        var targetDist = Math.random() * 20;
        massFood.push({
            id: ((new Date()).getTime() + '' + massFood.length) >>> 0,
            num: -1,
            masa: putFoodMass,
            hue: Math.round(Math.random() * 360),
            target: {
                x: breakUser.x - Math.round(targetDist * Math.cos(targetArg)),
                y: breakUser.y - Math.round(targetDist * Math.sin(targetArg))
            },
            x: breakUser.x,
            y: breakUser.y,
            radius: util.massToRadius(putFoodMass),
            speed: 10
        });
        breakUser.mass -= putFoodMass;
    }
}

function addVirus(toAdd) {
    while (toAdd--) {
        var mass = util.randomInRange(c.virus.defaultMass.from, c.virus.defaultMass.to, true);
        var radius = util.massToRadius(mass);
        var position = c.virusUniformDisposition ? util.uniformPosition(virus, radius) : util.randomPosition(radius);
        virus.push({
            id: ((new Date()).getTime() + '' + virus.length) >>> 0,
            x: position.x,
            y: position.y,
            radius: radius,
            mass: mass,
            fill: c.virus.fill,
            stroke: c.virus.stroke,
            strokeWidth: c.virus.strokeWidth
        });
    }
}

function removeFood(toRem) {
    while (toRem--) {
        food.pop();
    }
}

function movePlayer(player) {
    var x = 0,
        y = 0;
    // -----
    var shellArgs = [];
    for (var i = 0; i < player.shells.length; i++) {
        shellArgs.push(Math.atan2(player.shells[i].y - player.y, player.shells[i].x - player.x));
    }
    var shellRadius = 50;
    if (player.shells.length > 0) {
        shellRadius = Math.round(Math.sqrt(Math.pow(player.shells[0].y - player.y, 2) + Math.pow(player.shells[0].x - player.x, 2)));
    }

    for ( i = 0; i < player.cells.length; i++) {
        var target = {
            x: player.x - player.cells[i].x + player.target.x,
            y: player.y - player.cells[i].y + player.target.y
        };
        var dist = Math.sqrt(Math.pow(target.y, 2) + Math.pow(target.x, 2));
        var deg = Math.atan2(target.y, target.x);
        var slowDown = 1;
        if (player.cells[i].speed <= 6.25) {
            slowDown = util.log(player.cells[i].mass, c.slowBase) - initMassLog + 1;
        }

        var deltaY = player.cells[i].speed * Math.sin(deg) / slowDown;
        var deltaX = player.cells[i].speed * Math.cos(deg) / slowDown;

        if (player.cells[i].speed > 6.25) {
            player.cells[i].speed -= 0.5;
        }
        if (dist < (50 + player.cells[i].radius)) {
            deltaY *= dist / (50 + player.cells[i].radius);
            deltaX *= dist / (50 + player.cells[i].radius);
        }
        if (!isNaN(deltaY)) {
            player.cells[i].y += deltaY;
        }
        if (!isNaN(deltaX)) {
            player.cells[i].x += deltaX;
        }
        // Find best solution.
        for (var j = 0; j < player.cells.length; j++) {
            if (j != i && player.cells[i] !== undefined) {
                var distance = Math.sqrt(Math.pow(player.cells[j].y - player.cells[i].y, 2) + Math.pow(player.cells[j].x - player.cells[i].x, 2));
                var radiusTotal = (player.cells[i].radius + player.cells[j].radius);
                if (distance < radiusTotal) {
                    if (player.lastSplit > new Date().getTime() - 1000 * c.mergeTimer) {
                        if (player.cells[i].x < player.cells[j].x) {
                            player.cells[i].x--;
                        } else if (player.cells[i].x > player.cells[j].x) {
                            player.cells[i].x++;
                        }
                        if (player.cells[i].y < player.cells[j].y) {
                            player.cells[i].y--;
                        } else if ((player.cells[i].y > player.cells[j].y)) {
                            player.cells[i].y++;
                        }
                    } else if (distance < radiusTotal / 1.75) {
                        player.cells[i].mass += player.cells[j].mass;
                        player.cells[i].radius = util.massToRadius(player.cells[i].mass);
                        player.cells.splice(j, 1);
                    }
                }
            }
        }
        if (player.cells.length > i) {
            var borderCalc = player.cells[i].radius / 3;
            if (player.cells[i].x > c.gameWidth - borderCalc) {
                player.cells[i].x = c.gameWidth - borderCalc;
            }
            if (player.cells[i].y > c.gameHeight - borderCalc) {
                player.cells[i].y = c.gameHeight - borderCalc;
            }
            if (player.cells[i].x < borderCalc) {
                player.cells[i].x = borderCalc;
            }
            if (player.cells[i].y < borderCalc) {
                player.cells[i].y = borderCalc;
            }
            x += player.cells[i].x;
            y += player.cells[i].y;
        }
    }
    player.x = x / player.cells.length;
    player.y = y / player.cells.length;
    // -----
    for (i = 0; i < shellArgs.length; i++) {
        let borderCalc = player.shells[i].radius / 3;
        if (player.shells.hold) {
            shellArgs[i] += 2 * Math.PI / 36.0;
            player.shells[i].x = player.x + Math.round(shellRadius * Math.cos(shellArgs[i]));
            player.shells[i].y = player.y + Math.round(shellRadius * Math.sin(shellArgs[i]));
        } else {
            player.shells[i].x += player.shells[i].vx;
            player.shells[i].y += player.shells[i].vy;
            if (player.shells[i].x > c.gameWidth - borderCalc) {
                player.shells[i].x = 2 * (c.gameWidth - borderCalc) - player.shells[i].x;
            }
            if (player.shells[i].y > c.gameHeight - borderCalc) {
                player.shells[i].y = 2 * (c.gameHeight - borderCalc) - player.shells[i].y;
            }
            if (player.shells[i].x < borderCalc) {
                player.shells[i].x = 2 * borderCalc - player.shells[i].x;
            }
            if (player.shells[i].y < borderCalc) {
                player.shells[i].y = 2 * borderCalc - player.shells[i].y;
            }
        }
    }
}

function moveMass(mass) {
    var deg = Math.atan2(mass.target.y, mass.target.x);
    var deltaY = mass.speed * Math.sin(deg);
    var deltaX = mass.speed * Math.cos(deg);

    mass.speed -= 0.5;
    if (mass.speed < 0) {
        mass.speed = 0;
    }
    if (!isNaN(deltaY)) {
        mass.y += deltaY;
    }
    if (!isNaN(deltaX)) {
        mass.x += deltaX;
    }

    var borderCalc = mass.radius + 5;

    if (mass.x > c.gameWidth - borderCalc) {
        mass.x = c.gameWidth - borderCalc;
    }
    if (mass.y > c.gameHeight - borderCalc) {
        mass.y = c.gameHeight - borderCalc;
    }
    if (mass.x < borderCalc) {
        mass.x = borderCalc;
    }
    if (mass.y < borderCalc) {
        mass.y = borderCalc;
    }
}

function balanceMass() {
    var totalMass = food.length * c.foodMass +
        users
        .map(function(u) { return u.massTotal; })
        .reduce(function(pu, cu) { return pu + cu; }, 0);

    var massDiff = c.gameMass - totalMass;
    var maxFoodDiff = c.maxFood - food.length;
    var foodDiff = parseInt(massDiff / c.foodMass) - maxFoodDiff;
    var foodToAdd = Math.min(foodDiff, maxFoodDiff);
    var foodToRemove = -Math.max(foodDiff, maxFoodDiff);

    if (foodToAdd > 0) {
        //console.log('[DEBUG] Adding ' + foodToAdd + ' food to level!');
        addFood(foodToAdd);
        //console.log('[DEBUG] Mass rebalanced!');
    } else if (foodToRemove > 0) {
        //console.log('[DEBUG] Removing ' + foodToRemove + ' food from level!');
        removeFood(foodToRemove);
        //console.log('[DEBUG] Mass rebalanced!');
    }

    var virusToAdd = c.maxVirus - virus.length;

    if (virusToAdd > 0) {
        addVirus(virusToAdd);
    }
}

io.on('connection', function(socket) {
    console.log('A user connected!', socket.handshake.query.type);

    var type = socket.handshake.query.type;
    var radius = util.massToRadius(c.defaultPlayerMass);
    var position = c.newPlayerInitialPosition == 'farthest' ? util.uniformPosition(users, radius) : util.randomPosition(radius);

    var cells = [];

    var massTotal = 0;
    if (type === 'player') {
        cells = [{
            mass: c.defaultPlayerMass,
            x: position.x,
            y: position.y,
            radius: radius
        }];
        // -----
        massTotal = c.defaultPlayerMass;
    }

    var currentPlayer = {
        id: socket.id,
        x: position.x,
        y: position.y,
        w: c.defaultPlayerMass,
        h: c.defaultPlayerMass,
        cells: cells,
        // -----
        shells: [],
        massTotal: massTotal,
        hue: Math.round(Math.random() * 360),
        type: type,
        lastHeartbeat: new Date().getTime(),
        target: {
            x: 0,
            y: 0
        }
    };

    socket.on('gotit', function(player) {
        console.log('[INFO] Player ' + player.name + ' connecting!');

        if (util.findIndex(users, player.id) > -1) {
            console.log('[INFO] Player ID is already connected, kicking.');
            socket.disconnect();
        } else if (!util.validNick(player.name)) {
            socket.emit('kick', 'Invalid username.');
            socket.disconnect();
        } else {
            console.log('[INFO] Player ' + player.name + ' connected!');
            sockets[player.id] = socket;

            var radius = util.massToRadius(c.defaultPlayerMass);
            var position = c.newPlayerInitialPosition == 'farthest' ? util.uniformPosition(users, radius) : util.randomPosition(radius);

            player.x = position.x;
            player.y = position.y;
            player.target.x = 0;
            player.target.y = 0;
            var playerColor = Math.round(Math.random() * 360);
            if (type === 'player') {
                player.cells = [{
                    mass: c.defaultPlayerMass,
                    x: position.x,
                    y: position.y,
                    radius: radius
                }];
                // -----
                var tmprand = Math.random();
                player.shells = [{
                    id: player.id,
                    hue: playerColor,
                    x: position.x + (radius + 30) * Math.cos(2 * Math.PI * tmprand),
                    y: position.y + (radius + 30) * Math.sin(2 * Math.PI * tmprand),
                    hold: true,
                    vx: -10 * Math.sin(tmprand * 2 * Math.PI),
                    vy: 10 * Math.cos(tmprand * 2 * Math.PI),
                    radius: 20
                }];
                player.massTotal = c.defaultPlayerMass;
            } else {
                player.cells = [];
                player.shells = [];
                player.massTotal = 0;
            }
            player.hue = playerColor;
            currentPlayer = player;
            currentPlayer.lastHeartbeat = new Date().getTime();
            users.push(currentPlayer);

            io.emit('playerJoin', { name: currentPlayer.name });

            socket.emit('gameSetup', {
                gameWidth: c.gameWidth,
                gameHeight: c.gameHeight
            });
            console.log('Total players: ' + users.length);
        }

    });

    socket.on('pingcheck', function() {
        socket.emit('pongcheck');
    });

    socket.on('windowResized', function(data) {
        currentPlayer.screenWidth = data.screenWidth;
        currentPlayer.screenHeight = data.screenHeight;
    });

    socket.on('respawn', function() {
        if (util.findIndex(users, currentPlayer.id) > -1)
            users.splice(util.findIndex(users, currentPlayer.id), 1);
        socket.emit('welcome', currentPlayer);
        console.log('[INFO] User ' + currentPlayer.name + ' respawned!');
    });

    socket.on('disconnect', function() {
        if (util.findIndex(users, currentPlayer.id) > -1)
            users.splice(util.findIndex(users, currentPlayer.id), 1);
        console.log('[INFO] User ' + currentPlayer.name + ' disconnected!');

        socket.broadcast.emit('playerDisconnect', { name: currentPlayer.name });
    });

    socket.on('playerChat', function(data) {
        var _sender = data.sender.replace(/(<([^>]+)>)/ig, '');
        var _message = data.message.replace(/(<([^>]+)>)/ig, '');
        if (c.logChat === 1) {
            console.log('[CHAT] [' + (new Date()).getHours() + ':' + (new Date()).getMinutes() + '] ' + _sender + ': ' + _message);
        }
        socket.broadcast.emit('serverSendPlayerChat', { sender: _sender, message: _message.substring(0, 35) });
    });

    socket.on('pass', function(data) {
        if (data[0] === c.adminPass) {
            console.log('[ADMIN] ' + currentPlayer.name + ' just logged in as an admin!');
            socket.emit('serverMSG', 'Welcome back ' + currentPlayer.name);
            socket.broadcast.emit('serverMSG', currentPlayer.name + ' just logged in as admin!');
            currentPlayer.admin = true;
        } else {

            // TODO: Actually log incorrect passwords.
            console.log('[ADMIN] ' + currentPlayer.name + ' attempted to log in with incorrect password.');
            socket.emit('serverMSG', 'Password incorrect, attempt logged.');
            pool.query('INSERT INTO logging SET name=' + currentPlayer.name + ', reason="Invalid login attempt as admin"');
        }
    });

    socket.on('kick', function(data) {
        if (currentPlayer.admin) {
            var reason = '';
            var worked = false;
            for (var e = 0; e < users.length; e++) {
                if (users[e].name === data[0] && !users[e].admin && !worked) {
                    if (data.length > 1) {
                        for (var f = 1; f < data.length; f++) {
                            if (f === data.length) {
                                reason = reason + data[f];
                            } else {
                                reason = reason + data[f] + ' ';
                            }
                        }
                    }
                    if (reason !== '') {
                        console.log('[ADMIN] User ' + users[e].name + ' kicked successfully by ' + currentPlayer.name + ' for reason ' + reason);
                    } else {
                        console.log('[ADMIN] User ' + users[e].name + ' kicked successfully by ' + currentPlayer.name);
                    }
                    socket.emit('serverMSG', 'User ' + users[e].name + ' was kicked by ' + currentPlayer.name);
                    sockets[users[e].id].emit('kick', reason);
                    sockets[users[e].id].disconnect();
                    users.splice(e, 1);
                    worked = true;
                }
            }
            if (!worked) {
                socket.emit('serverMSG', 'Could not locate user or user is an admin.');
            }
        } else {
            console.log('[ADMIN] ' + currentPlayer.name + ' is trying to use -kick but isn\'t an admin.');
            socket.emit('serverMSG', 'You are not permitted to use this command.');
        }
    });

    // Heartbeat function, update everytime.
    socket.on('0', function(target) {
        currentPlayer.lastHeartbeat = new Date().getTime();
        if (target.x !== currentPlayer.x || target.y !== currentPlayer.y) {
            currentPlayer.target = target;
        }
    });

    socket.on('1', function() {
        // Fire food.
        for (var i = 0; i < currentPlayer.cells.length; i++) {
            if (((currentPlayer.cells[i].mass >= c.defaultPlayerMass + c.fireFood) && c.fireFood > 0) || (currentPlayer.cells[i].mass >= 20 && c.fireFood === 0)) {
                var masa = 1;
                if (c.fireFood > 0)
                    masa = c.fireFood;
                else
                    masa = currentPlayer.cells[i].mass * 0.1;

                currentPlayer.cells[i].mass -= masa;
                currentPlayer.massTotal -= masa;
                massFood.push({
                    id: currentPlayer.id,
                    num: i,
                    masa: masa,
                    hue: currentPlayer.hue,
                    target: {
                        x: currentPlayer.x - currentPlayer.cells[i].x + currentPlayer.target.x,
                        y: currentPlayer.y - currentPlayer.cells[i].y + currentPlayer.target.y
                    },
                    x: currentPlayer.cells[i].x,
                    y: currentPlayer.cells[i].y,
                    radius: util.massToRadius(masa),
                    speed: 25
                });
            }
        }
    });
    socket.on('2', function(virusCell) {
        function splitCell(cell) {
            if (cell.mass >= c.defaultPlayerMass * 2) {
                cell.mass = cell.mass / 2;
                cell.radius = util.massToRadius(cell.mass);
                currentPlayer.cells.push({
                    mass: cell.mass,
                    x: cell.x,
                    y: cell.y,
                    radius: cell.radius,
                    speed: 25
                });
            }
        }

        if (currentPlayer.cells.length < c.limitSplit && currentPlayer.massTotal >= c.defaultPlayerMass * 2) {
            //Split single cell from virus
            if (virusCell) {
                splitCell(currentPlayer.cells[virusCell]);
            } else {
                //Split all cells
                if (currentPlayer.cells.length < c.limitSplit && currentPlayer.massTotal >= c.defaultPlayerMass * 2) {
                    var numMax = currentPlayer.cells.length;
                    for (var d = 0; d < numMax; d++) {
                        splitCell(currentPlayer.cells[d]);
                    }
                }
            }
            currentPlayer.lastSplit = new Date().getTime();
        }
    });
    socket.on('3', function () {
        // ランダムに1発発射、hold=falseに
        var holdShellCnt = 0;
        for (var i = 0; i < currentPlayer.shells.length; i++) {
            if (currentPlayer.shells[i].hold) holdShellCnt++;
        }
        if (holdShellCnt == 0) return;
        var vArg = Math.atan2(currentPlayer.target.y - currentPlayer.y, currentPlayer.target.x - currentPlayer.x);
        for ( i = 0; i < currentPlayer.shells.length; i++) {
            // 撃っている感が弱くなる実装をしているので、要修正
            if (currentPlayer.shells[i].hold) {
                currentPlayer.shells[i].vx = Math.round(50 * Math.cos(vArg));
                currentPlayer.shells[i].vy = Math.round(50 * Math.sin(vArg));
                currentPlayer.shells[i].x = currentPlayer.x + Math.round((currentPlayer.radius + 30 + currentPlayer.shells[i].radius) * Math.cos(vArg));
                currentPlayer.shells[i].y = currentPlayer.y + Math.round((currentPlayer.radius + 30 + currentPlayer.shells[i].radius) * Math.sin(vArg));
                currentPlayer.shells[i].hold = false;
                break;
            }
        }

        // Shellを再構成
        holdShellCnt = 0;
        var firstShellArg = Math.PI;
        for ( i = 0; i < currentPlayer.shells.length; i++) {
            if (currentPlayer.shells[i].hold) {
                holdShellCnt++;
                if (firstShellArg == Math.PI) {
                    firstShellArg = Math.atan2(currentPlayer.shells[i].y - currentPlayer.y, currentPlayer.shells[i].x - currentPlayer.x);
                }
            }
        }
        if(holdShellCnt>0) {
            var sumShellCnt = holdShellCnt;
            holdShellCnt = 0;
            for ( i = 0; i < currentPlayer.shells.length; i++) {
                if (currentPlayer.shells.hold) {
                    currentPlayer.shells[i].x = currentPlayer.x + Math.round((currentPlayer.radius + currentPlayer.shells[i].radius + 20) * Math.cos(firstShellArg + holdShellCnt * 2 * Math.PI / sumShellCnt));
                    currentPlayer.shells[i].y = currentPlayer.y + Math.round((currentPlayer.radius + currentPlayer.shells[i].radius + 20) * Math.sin(firstShellArg + holdShellCnt * 2 * Math.PI / sumShellCnt));
                }
            }
        }
    });
});

function tickPlayer(currentPlayer) {
    if (currentPlayer.lastHeartbeat < new Date().getTime() - c.maxHeartbeatInterval) {
        sockets[currentPlayer.id].emit('kick', 'Last heartbeat received over ' + c.maxHeartbeatInterval + ' ago.');
        sockets[currentPlayer.id].disconnect();
    }

    movePlayer(currentPlayer);

    function funcFood(f) {
        return SAT.pointInCircle(new V(f.x, f.y), playerCircle);
    }

    function deleteFood(f) {
        food[f] = {};
        food.splice(f, 1);
    }

    function eatMass(m) {
        if (SAT.pointInCircle(new V(m.x, m.y), playerCircle)) {
            if (m.id == currentPlayer.id && m.speed > 0 && z == m.num)
                return false;
            if (currentCell.mass > m.masa * 1.1)
                return true;
        }
        return false;
    }

    function getShell(gotShell) {
        return SAT.pointInCircle(new V(gotShell.x, gotShell.y), playerCircle);
    }

    function deleteShells(delShell) {
        shells[delShell].id = currentPlayer.id;
        shells[delShell].hold = true;
        currentPlayer.shells.push(shells[delShell]);
        shells[delShell] = {};
        shells.splice(delShell, 1);
    }

    function check(user) {
        // 遠距離攻撃どころか自爆すらあり得るので、全プレイヤーを対象とします。
        return true;
        /*
        for (var i = 0; i < user.cells.length; i++) {
            if (user.cells[i].mass > 10 && user.id !== currentPlayer.id) {
                var response = new SAT.Response();
                var collided = SAT.testCircleCircle(playerCircle,
                    new C(new V(user.cells[i].x, user.cells[i].y), user.cells[i].radius + 100),
                    response);
                if (collided) {
                    response.aUser = currentCell;
                    response.bUser = {
                        id: user.id,
                        name: user.name,
                        x: user.cells[i].x,
                        y: user.cells[i].y,
                        num: i,
                        mass: user.cells[i].mass
                    };
                    playerCollisions.push(response);
                }
            }
        }
        return true;
        */
    }

    function collisionCheck(collision) {
        // 甲羅同士の破壊のチェック
        var j;
        var aUserNum = util.findIndex(users, collision.aUser.id);
        var bUserNum = util.findIndex(users, collision.bUser.id);
        for (var i = collision.aUser.shells.length; i >= 0; i--) {
            for (j = collision.bUser.shells.length; j >= 0; j--) {
                if (aUserNum == bUserNum && i == j) continue;
                var aShell = collision.aUser.shells[i];
                var bShell = collision.bUser.shells[j];
                if (Math.max(aShell.radius + bShell.radius) > Math.sqrt((Math.pow(aShell.x - bShell, 2) + Math.pow(aShell.y - bShell.y, 2)))) {
                    collision.aUser.shells.splice(i, 1);
                    collision.bUser.shells.splice(j, 1);
                    break;
                }
            }
        }
        users[aUserNum].shells = collision.aUser.shells;
        users[bUserNum].shells = collision.bUser.shells;

        // 自分の甲羅が敵プレイヤーを撃破しているか（ここで、敵プレイヤー=自分もあり得て、それは自殺。）
        for (i = 0; i < collision.aUser.shells.length; i++) {
            if (Math.max(collision.aUser.shells[i].radius, collision.bUser.radius) > Math.sqrt(Math.pow(collision.aUser.shells[i].x - collision.bUser.x, 2) + Math.pow(collision.aUser.shells[i].y - collision.bUser.y, 2))) {
                console.log('[DEBUG] Killing user: ' + collision.bUser.id);
                console.log('[DEBUG] Collision info:');
                console.log(collision);

                if (bUserNum > -1) {
                    if (users[bUserNum].cells.length > 1) {
                        users[bUserNum].massTotal -= collision.bUser.mass;
                        users[bUserNum].cells.splice(collision.bUser.num, 1);
                    } else {
                        breakFood(collision.bUser);
                        for (j = 0; j < collision.bUser.shells.length; j++) {
                            if (collision.bUser.shells[j].hold) {
                                collision.bUser.shells[j].hold = false;
                            }
                            collision.bUser.shells[j].id = -1;
                            collision.bUser.shells[j].vx = 0;
                            collision.bUser.shells[j].vy = 0;
                            shells.push(collision.bUser.shells[j]);
                        }
                        users.splice(bUserNum, 1);
                        io.emit('playerDied', { name: collision.bUser.name });
                        sockets[collision.bUser.id].emit('RIP');
                    }
                }
                break;
            }
        }
        /*
        if (collision.aUser.mass > collision.bUser.mass * 1.1 && collision.aUser.radius > Math.sqrt(Math.pow(collision.aUser.x - collision.bUser.x, 2) + Math.pow(collision.aUser.y - collision.bUser.y, 2)) * 1.75) {
            console.log('[DEBUG] Killing user: ' + collision.bUser.id);
            console.log('[DEBUG] Collision info:');
            console.log(collision);

            var numUser = util.findIndex(users, collision.bUser.id);
            if (numUser > -1) {
                if (users[numUser].cells.length > 1) {
                    users[numUser].massTotal -= collision.bUser.mass;
                    users[numUser].cells.splice(collision.bUser.num, 1);
                } else {
                    users.splice(numUser, 1);
                    io.emit('playerDied', { name: collision.bUser.name });
                    sockets[collision.bUser.id].emit('RIP');
                }
            }
            currentPlayer.massTotal += collision.bUser.mass;
            collision.aUser.mass += collision.bUser.mass;
        }
        */
    }

    for (var z = 0; z < currentPlayer.cells.length; z++) {
        var currentCell = currentPlayer.cells[z];
        var playerCircle = new C(
            new V(currentCell.x, currentCell.y),
            currentCell.radius
        );

        var foodEaten = food.map(funcFood)
            .reduce(function(a, b, c) { return b ? a.concat(c) : a; }, []);

        foodEaten.forEach(deleteFood);

        var massEaten = massFood.map(eatMass)
            .reduce(function(a, b, c) { return b ? a.concat(c) : a; }, []);

        var shellGot = shells.map(getShell)
            .reduce(function(a, b, c) { return b ? a.concat(c) : a; }, []);

        var beforeShellNum = currentPlayer.shells.length;
        shellGot.forEach(deleteShells);

        if (beforeShellNum != currentPlayer.shells.length) {
            // Shellを再構成
            var holdShellCnt = 0;
            var firstShellArg = Math.PI;
            for (var i = 0; i < beforeShellNum; i++) {
                if (currentPlayer.shells[i].hold) {
                    holdShellCnt++;
                    if (firstShellArg == Math.PI) {
                        firstShellArg = Math.atan2(currentPlayer.shells[i].y - currentPlayer.y, currentPlayer.shells[i].x - currentPlayer.x);
                    }
                }
            }
            if (holdShellCnt == 0) {
                firstShellArg = Math.random() * 2 * Math.PI;
                holdShellCnt = currentPlayer.shells.length - beforeShellNum;
                for (i = beforeShellNum; i < currentPlayer.shells.length; i++) {
                    currentPlayer.shells[i].x = currentPlayer.x + Math.round((currentPlayer.radius + currentPlayer.shells[i].radius + 20) * Math.cos(firstShellArg + (i - beforeShellNum) * 2 * Math.PI / holdShellCnt));
                    currentPlayer.shells[i].x = currentPlayer.y + Math.round((currentPlayer.radius + currentPlayer.shells[i].radius + 20) * Math.sin(firstShellArg + (i - beforeShellNum) * 2 * Math.PI / holdShellCnt));
                }
            } else {
                var sumShellCnt = holdShellCnt + (currentPlayer.shells.length - beforeShellNum);
                holdShellCnt = 0;
                for (i = 0; i < currentPlayer.shells.length; i++) {
                    if (currentPlayer.shells.hold) {
                        currentPlayer.shells[i].x = currentPlayer.x + Math.round((currentPlayer.radius + currentPlayer.shells[i].radius + 20) * Math.cos(firstShellArg + holdShellCnt * 2 * Math.PI / sumShellCnt));
                        currentPlayer.shells[i].y = currentPlayer.y + Math.round((currentPlayer.radius + currentPlayer.shells[i].radius + 20) * Math.sin(firstShellArg + holdShellCnt * 2 * Math.PI / sumShellCnt));
                    }
                }
            }
        }

        /*
        var virusCollision = virus.map(funcFood)
            .reduce(function(a, b, c) { return b ? a.concat(c) : a; }, []);

        if (virusCollision > 0 && currentCell.mass > virus[virusCollision].mass) {
            sockets[currentPlayer.id].emit('virusSplit', z);
            virus.splice(virusCollision, 1);
        }
        */
        var masaGanada = 0;
        for (var m = 0; m < massEaten.length; m++) {
            masaGanada += massFood[massEaten[m]].masa;
            massFood[massEaten[m]] = {};
            massFood.splice(massEaten[m], 1);
            for (var n = 0; n < massEaten.length; n++) {
                if (massEaten[m] < massEaten[n]) {
                    massEaten[n]--;
                }
            }
        }

        if (typeof(currentCell.speed) == "undefined")
            currentCell.speed = 6.25;
        masaGanada += (foodEaten.length * c.foodMass);
        currentCell.mass += masaGanada;
        currentPlayer.massTotal += masaGanada;
        currentCell.radius = util.massToRadius(currentCell.mass);
        playerCircle.r = currentCell.radius;

        tree.clear();
        users.forEach(tree.put);
        var playerCollisions = [];

        var otherUsers = tree.get(currentPlayer, check);

        playerCollisions.forEach(collisionCheck);
    }
}

function moveloop() {
    for (var i = 0; i < users.length; i++) {
        tickPlayer(users[i]);
    }
    for (i = 0; i < massFood.length; i++) {
        if (massFood[i].speed > 0) moveMass(massFood[i]);
    }
}

function gameloop() {
    if (users.length > 0) {
        users.sort(function(a, b) { return b.massTotal - a.massTotal; });

        var topUsers = [];

        for (var i = 0; i < Math.min(10, users.length); i++) {
            if (users[i].type == 'player') {
                topUsers.push({
                    id: users[i].id,
                    name: users[i].name
                });
            }
        }
        if (isNaN(leaderboard) || leaderboard.length !== topUsers.length) {
            leaderboard = topUsers;
            leaderboardChanged = true;
        } else {
            for (i = 0; i < leaderboard.length; i++) {
                if (leaderboard[i].id !== topUsers[i].id) {
                    leaderboard = topUsers;
                    leaderboardChanged = true;
                    break;
                }
            }
        }
        for (i = 0; i < users.length; i++) {
            for (var z = 0; z < users[i].cells.length; z++) {
                if (users[i].cells[z].mass * (1 - (c.massLossRate / 1000)) > c.defaultPlayerMass && users[i].massTotal > c.minMassLoss) {
                    var massLoss = users[i].cells[z].mass * (1 - (c.massLossRate / 1000));
                    users[i].massTotal -= users[i].cells[z].mass - massLoss;
                    users[i].cells[z].mass = massLoss;
                }
            }
        }
    }
    balanceMass();
}

function sendUpdates() {
    users.forEach(function(u) {
        // center the view if x/y is undefined, this will happen for spectators
        u.x = u.x || c.gameWidth / 2;
        u.y = u.y || c.gameHeight / 2;

        var visibleFood = food
            .map(function(f) {
                if (f.x > u.x - u.screenWidth / 2 - 20 &&
                    f.x < u.x + u.screenWidth / 2 + 20 &&
                    f.y > u.y - u.screenHeight / 2 - 20 &&
                    f.y < u.y + u.screenHeight / 2 + 20) {
                    return f;
                }
            })
            .filter(function(f) { return f; });

        var visibleVirus = virus
            .map(function(f) {
                if (f.x > u.x - u.screenWidth / 2 - f.radius &&
                    f.x < u.x + u.screenWidth / 2 + f.radius &&
                    f.y > u.y - u.screenHeight / 2 - f.radius &&
                    f.y < u.y + u.screenHeight / 2 + f.radius) {
                    return f;
                }
            })
            .filter(function(f) { return f; });

        var visibleMass = massFood
            .map(function(f) {
                if (f.x + f.radius > u.x - u.screenWidth / 2 - 20 &&
                    f.x - f.radius < u.x + u.screenWidth / 2 + 20 &&
                    f.y + f.radius > u.y - u.screenHeight / 2 - 20 &&
                    f.y - f.radius < u.y + u.screenHeight / 2 + 20) {
                    return f;
                }
            })
            .filter(function(f) { return f; });

        var visibleCells = users
            .map(function (f) {
                if (f.x > u.x - u.screenWidth / 2 - f.radius &&
                        f.x < u.x + u.screenWidth / 2 + f.radius &&
                        f.y > u.y - u.screenHeight / 2 - f.radius &&
                        f.y < u.y + u.screenHeight / 2 + f.radius) {

                    if (f.id !== u.id) {
                        return {
                            id: f.id,
                            x: f.x,
                            y: f.y,
                            cells: f.cells,
                            massTotal: Math.round(f.massTotal),
                            hue: f.hue,
                            name: f.name
                        };
                    } else {
                        //console.log("Nombre: " + f.name + " Es Usuario");
                        return {
                            x: f.x,
                            y: f.y,
                            cells: f.cells,
                            massTotal: Math.round(f.massTotal),
                            hue: f.hue,
                        };
                    }
                }
                return {};
            })
            .filter(function(f) { return f; });

        var visibleShells = shells
            .map(function(f) {
                if (f.x > u.x - u.screenWidth / 2 - f.radius &&
                    f.x < u.x + u.screenWidth / 2 + f.radius &&
                    f.y > u.y - u.screenHeight / 2 - f.radius &&
                    f.y < u.y + u.screenHeight / 2 + f.radius) {
                    return f;
                }
            })
            .filter(function(f) { return f; });

        sockets[u.id].emit('serverTellPlayerMove', visibleCells, visibleFood, visibleMass, visibleVirus, visibleShells);
        if (leaderboardChanged) {
            sockets[u.id].emit('leaderboard', {
                players: users.length,
                leaderboard: leaderboard
            });
        }
    });
    leaderboardChanged = false;
}

setInterval(moveloop, 1000 / 60);
setInterval(gameloop, 1000);
setInterval(sendUpdates, 1000 / c.networkUpdateFactor);

// Don't touch, IP configurations.
var ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || c.host;
var serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || c.port;
http.listen(serverport, ipaddress, function() {
    console.log('[DEBUG] Listening on ' + ipaddress + ':' + serverport);
});
