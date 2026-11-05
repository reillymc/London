const {series, parallel, watch, src, dest} = require('gulp');
const pump = require('pump');
const fs = require('fs');
const order = require('ordered-read-streams');

// gulp plugins and utils
const livereload = require('gulp-livereload');
const postcss = require('gulp-postcss');
const concat = require('gulp-concat');
const uglify = require('gulp-uglify');
const beeper = require('beeper');
const zip = require('gulp-zip');

// postcss plugins
const easyimport = require('postcss-easy-import');
const autoprefixer = require('autoprefixer');
const cssnano = require('cssnano');

function serve(done) {
    livereload.listen();
    done();
}

function handleError(done) {
    return function (err) {
        if (err) {
            beeper();
        }
        return done(err);
    };
};

function hbs(done) {
    pump([
        src(['*.hbs', 'partials/**/*.hbs']),
        livereload()
    ], handleError(done));
}

function css(done) {
    pump([
        src([
            'assets/css/screen.css',
            'assets/css/journey-map.css'
        ], {sourcemaps: true}),
        postcss([
            easyimport,
            autoprefixer(),
            cssnano()
        ]),
        dest('assets/built/', {sourcemaps: '.'}),
        livereload()
    ], handleError(done));
}

function getJsFiles(version) {
    const jsFiles = [
        src(`node_modules/@tryghost/shared-theme-assets/assets/js/${version}/lib/**/*.js`),
        src(`node_modules/@tryghost/shared-theme-assets/assets/js/${version}/main.js`),
    ];

    if (fs.existsSync(`assets/js/lib`)) {
        jsFiles.push(src(`assets/js/lib/*.js`));
    }

    jsFiles.push(src(`assets/js/main.js`));

    return jsFiles;
}

function compileJs(getStream, filename) {
    return function (done) {
        pump([
            getStream(),
            concat(filename),
            uglify(),
            dest('assets/built/', {sourcemaps: '.'}),
            livereload()
        ], handleError(done));
    };
}

const js = compileJs(
    () => order(getJsFiles('v1'), {sourcemaps: true}),
    'main.min.js'
);

const journeyMapJs = compileJs(
    () => src('assets/js/journey-map.js', {sourcemaps: true}),
    'journey-map.js'
);

js.displayName = 'js';
journeyMapJs.displayName = 'journeyMapJs';

function zipper(done) {
    const filename = require('./package.json').name + '.zip';

    pump([
        src([
            '**',
            '!node_modules', '!node_modules/**',
            '!dist', '!dist/**',
            '!yarn-error.log'
        ]),
        zip(filename),
        dest('dist/')
    ], handleError(done));
}

const build = series(css, parallel(js, journeyMapJs));
const hbsWatcher = () => watch(['*.hbs', 'partials/**/*.hbs'], hbs);
const cssWatcher = () => watch('assets/css/**/*.css', css);
const jsWatcher = () => watch('assets/js/**/*.js', parallel(js, journeyMapJs));
const zipWatcher = () => watch(
    ['*.hbs', 'partials/**/*.hbs', 'assets/**/*', '!assets/built/**', 'package.json'],
    series(build, zipper)
);
const watcher = parallel(hbsWatcher, cssWatcher, jsWatcher);

exports.build = build;
exports.zip = series(build, zipper);
exports.watchZip = series(build, zipper, zipWatcher);
exports.default = series(build, serve, watcher);
