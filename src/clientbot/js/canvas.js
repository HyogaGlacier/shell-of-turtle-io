var global = require('./global');

class Canvas {
    constructor(params) {
        this.directionLock = false;
        this.target = global.target;
        this.reenviar = true;
        this.socket = global.socket;
        this.directions = [];
        var self = this;

        this.cv = document.getElementById('cvs');
        this.cv.width = global.screenWidth;
        this.cv.height = global.screenHeight;
        this.cv.parent = self;
        global.canvas = this;
    }
}

module.exports = Canvas;
