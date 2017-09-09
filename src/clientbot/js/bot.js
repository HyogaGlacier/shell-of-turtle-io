class Bot {
    constructor({feed: feedFun, split: splitFun}) {
        this.feed = feedFun;
        this.split = splitFun;
        this.player = {};
        this.target = {x: 0, y: 0};
    }

    onServerTellPlayerMove(userData, foodsList, massList, virusList) {
        let playerData;
        for(let i =0; i< userData.length; i++) {
            if(typeof(userData[i].id) == "undefined") {
                playerData = userData[i];
                i = userData.length;
            }
        }

        let nearestFoodOffsetX = Infinity;
        let nearestFoodOffsetY = Infinity;
        for(let i=0; i<foodsList.length; i++) {
            const food = foodsList[i];
            const offsetX = food.x - playerData.x;
            const offsetY = food.y - playerData.y;
            if(offsetX * offsetX + offsetY * offsetY < nearestFoodOffsetX * nearestFoodOffsetX + nearestFoodOffsetY * nearestFoodOffsetY) {
                nearestFoodOffsetX = offsetX;
                nearestFoodOffsetY = offsetY;
            }
        }

        var xoffset = this.player.x - playerData.x;
        var yoffset = this.player.y - playerData.y;

        this.player.x = playerData.x;
        this.player.y = playerData.y;
        this.player.hue = playerData.hue;
        this.player.massTotal = playerData.massTotal;
        this.player.cells = playerData.cells;
        this.player.xoffset = isNaN(xoffset) ? 0 : xoffset;
        this.player.yoffset = isNaN(yoffset) ? 0 : yoffset;

        //console.log(nearestFoodOffsetX, nearestFoodOffsetY);
        this.target = {x: nearestFoodOffsetX, y: nearestFoodOffsetY};

        this.users = userData;
        this.foods = foodsList;
        this.viruses = virusList;
        this.fireFood = massList;
    }
}

module.exports = Bot;
