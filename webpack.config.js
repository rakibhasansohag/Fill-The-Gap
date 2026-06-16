const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isDev = argv.mode === 'development';

  return {
    entry: {
      'background/service-worker': './src/background/service-worker.ts',
      'content/content-script': './src/content/content-script.ts',
      'popup/popup': './src/popup/popup.ts',
      'options/options': './src/options/options.ts',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: {
        '@shared': path.resolve(__dirname, 'src/shared'),
        '@utils': path.resolve(__dirname, 'src/utils'),
        '@background': path.resolve(__dirname, 'src/background'),
        '@content': path.resolve(__dirname, 'src/content'),
      },
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader'],
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({ filename: '[name].css' }),
      new HtmlWebpackPlugin({
        template: './src/popup/popup.html',
        filename: 'popup/popup.html',
        chunks: ['popup/popup'],
        inject: true,
      }),
      new HtmlWebpackPlugin({
        template: './src/options/options.html',
        filename: 'options/options.html',
        chunks: ['options/options'],
        inject: true,
      }),
      new CopyWebpackPlugin({
        patterns: [
          { from: 'manifest.json', to: 'manifest.json' },
          { from: 'public/icons', to: 'icons' },
        ],
      }),
    ],
    devtool: isDev ? 'inline-source-map' : false,
    optimization: {
      splitChunks: false,
    },
  };
};
