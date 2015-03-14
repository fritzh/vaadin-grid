var bower =  require('gulp-bower');
var config = require('./config');
var common = require('./common')
var gulp = require('gulp');
var fs = require('fs-extra');
var replace = require('gulp-replace');
var rsync = require('gulp-rsync');
var gutil = require('gulp-util');
var _ = require('lodash');
var args = require('yargs').argv;

var stagingBasePath = config.paths.staging.cdn;
var stagingPath = stagingBasePath + '/' + config.version;
var version = args.release || args.autoRevert ? config.version : config.snapshotVersion;

gulp.task('cdn:clean', function() {
  fs.removeSync(stagingBasePath);
});

gulp.task('cdn:stage-components', ['cdn:clean'], function() {
  var files = fs.readdirSync('vaadin-components');

  var paths = _.map(files, function(n) {
    return 'vaadin-components/' + n + '/**/*';
  }).concat([
    '!**/.idea/**/*',
    '!**/test/**/*',
    '!**/demo*',
    '!**/demo/*',
    '!**/bigdata.js']);;

  return gulp.src(paths)
    .pipe(replace(/(src|href)=("|')(.*?)\.\.\/\.\.\/bower_components\/(.*?)\//mg, '$1=$2$4/'))
    .pipe(gulp.dest(stagingPath));
});

gulp.task('cdn:stage-bower_components', ['cdn:clean'], function() {
  return bower({
    directory: stagingPath,
    forceLatest: true,
    cmd: 'install'
  }, [['./vaadin-components-package/']]);
});

gulp.task('cdn:fix-object-observe', ['bower:stage-imports'], function() {
  return gulp.src(stagingPath + '/*')
    .pipe(replace(/object.observe/mg, 'object-observe'))
    .pipe(gulp.dest(stagingPath));
});

gulp.task('stage:cdn', ['cdn:stage-components', 'cdn:stage-bower_components', 'cdn:fix-object-observe']);

gulp.task('deploy:cdn', ['stage:cdn'], function() {
  common.checkArguments(['cdnUsername', 'cdnDestination']);

  return gulp.src(stagingPath)
    .pipe(rsync({
      username: args.cdnUsername,
      hostname: 'cdn.vaadin.com',
      root: stagingPath,
      emptyDirectories: false,
      recursive: true,
      clean: true,
      silent: true,
      destination: args.cdnDestination + version
    }));
});

gulp.task('cdn-test:clean', function() {
  fs.removeSync(stagingPath + '/test');
});

gulp.task('cdn-test:install-dependencies', function() {
  return bower({
    directory: stagingPath,
    forceLatest: true,
    cmd: 'install'
  }, [['web-component-tester']]);
});

gulp.task('cdn-test:stage', ['cdn-test:clean', 'cdn-test:install-dependencies'], function() {
  return gulp.src('vaadin-components/**/test/**/*')
    .pipe(replace(/(src|href)=("|')(.*?)\.\.\/\.\.\/(bower_components|node_modules)\/(.*?)\//mg, '$1=$2https://cdn.vaadin.com/vaadin-components/'+ version +'/$5/'))
    .pipe(replace(/(src|href)=("|')(.*?)\.\.\//mg, '$1=$2https://cdn.vaadin.com/vaadin-components/'+ version +'/'))
    .pipe(replace(/(src|href)=("|')(.*?)(web-component-tester)\//mg, '$1=$2../../../web-component-tester/'))
    .pipe(gulp.dest(stagingPath + '/test/'));
});

gulp.task('verify:cdn', ['cdn-test:stage'], function(done) {
  common.checkArguments(['cdnUsername', 'cdnDestination']);

  // use unique browser combination because bower,cdn,zip verifications are run
  // at the same time and TeamCity test results will get mixed up if same browsers are used.
  common.testSauce(
    ['target/cdn/' + version + '/test/**/test'],
    ['Windows 7/firefox@36'],
    'vaadin-components / cdn.vaadin.com / ' + version,
    function(err) {
      common.handleRevert(err, function() {
        gutil.log('Deleting folder ' + args.cdnDestination + version);

        require('node-ssh-exec')({
          host: 'cdn.vaadin.com',
          username: args.cdnUsername,
          privateKey: require('fs').readFileSync(config.paths.userhome + '/.ssh/id_rsa')
        }, 'rm -rf ' + args.cdnDestination + version, function (error, response) {
          if (error) {
            throw error;
          }

          gutil.log(response);

          done(err);
        });

      }, done)});
});