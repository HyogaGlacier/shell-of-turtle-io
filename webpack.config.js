module.exports = {
    entry: "./src/clientbot/js/app.js",
    output: {
        path: require("path").resolve("./src/bin/clientbot/js"),
        library: "app",
        filename: "app.js"
    },
    module: {
        loaders: [
            {
                test: /\.jsx?$/,
                exclude: /(node_modules|bower_components)/,
                loader: 'babel'
            }
        ]
    }
};
