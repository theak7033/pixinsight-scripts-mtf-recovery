// ============================================================
// tools/smoketest.js — unit and end-to-end tests of the PixInsight-side
// code, run against a FAKE PixInsight.
//
// Run:  tools/test.sh
//
// Every PixInsight global is replaced by a stub. Three kinds of test:
//   1. end-to-end: the dialog is "accepted" and the full pipeline runs;
//   2. unit: each helper, dialog method and processing step, including
//      the failure paths;
//   3. coverage: every named function and class method of the script must
//      have been entered at least once, or the run fails.
//
// LIMIT: the stubs accept any property or method name, so a wrong
// PixInsight API name passes here. Only a run inside PixInsight proves the
// GUI and process calls.
// ============================================================

var IS_NODE = ( typeof require === "function" );
var out = IS_NODE ? function( s ) { console.log( s ); } : print;
var readText = IS_NODE
   ? function( p ) { return require( "fs" ).readFileSync( p, "utf8" ); }
   : function( p ) { return readFile( p ); };
function exitWith( code ) {
   if ( IS_NODE ) process.exit( code );
   // jsc's quit() ignores its argument; an uncaught exception is the only
   // way to hand a non-zero status to the shell.
   if ( code !== 0 ) throw new Error( "tests failed (exit " + code + ")" );
   quit();
}

var SCRIPT = "src/scripts/ObstructionCorrection/ObstructionCorrection.js";
var KEY = "ObstructionCorrection/";

// ---- load + instrument the script -----------------------------------------
// PJSR directive lines are blanked, then a coverage probe is inserted at the
// top of every named function and every class method.
var declared = {};            // name -> true, every probe inserted
var entered = {};             // name -> call count
function cov( name ) { entered[name] = ( entered[name] || 0 ) + 1; }

var src = readText( SCRIPT ).split( "\n" ).map( function( line ) {
   if ( /^#/.test( line ) )
      return "";
   var m = /^ {3}(\w+)\(([^)]*)\) \{$/.exec( line );                 // class method
   if ( m && [ "if", "for", "while", "switch", "catch" ].indexOf( m[1] ) < 0 ) {
      declared[ "Dialog." + m[1] ] = true;
      return line + " __cov( \"Dialog." + m[1] + "\" );";
   }
   return line.replace( /function (\w+)\(([^)]*)\) \{/g, function( all, name ) {
      declared[name] = true;
      return all + " __cov( \"" + name + "\" );";
   } );
} ).join( "\n" );

var EXPORTS = [
   "errText", "trySet", "uniqueViewId", "closeWindow", "readSetting", "writeSetting",
   "keywordDict", "mat22", "detectImageScale", "createKernelWindow", "pixelMathToNewGray",
   "convolveWithKernel", "gaussianBlur", "copyMetadata", "applyCorrection", "main", "log",
   "ObstructionCorrectionDialog", "buildKernel", "obstructionGain", "kernelResponse",
   "imageScaleArcsec", "opticsLabel", "opticsKey", "obstructedOptics", "OPTICS", "BANDS",
   "MODE_RESTORE_ONLY", "MODE_TRUE_EQUIVALENT", "MODE_IDEAL_APERTURE", "DEFAULT_MAX_BOOST",
   "OPTICS_OBSTRUCTED", "OPTICS_REFRACTOR", "MODE_ITEMS", "modeName", "modeDescription",
   "VERSION", "TELEMETRY", "telemetryConfigured", "installId", "scrubText", "round", "telemetryRecord",
   "sendTelemetry", "reportUsage", "runState", "telemetryBody", "yesNo"
];

// ---- the fake PixInsight ---------------------------------------------------
// opts: color, median, solved, masked, keywords, store, cancel, tweak( dialog ),
//       failProcess( kind, process, view ) -> false | throws,
//       hideWindow( id ) -> true, settingsThrow, noActiveWindow,
//       telemetry (configure a test form), netFail, netThrow, netCode
function runScript( opts ) {
   var R = { lines: [], calls: [], views: {}, store: opts.store || {}, threw: null,
             dialogs: [], shown: [], procs: [], posts: [] };

   // Swallows any property write and answers any unknown call.
   function loose( target ) {
      return new Proxy( target, {
         get: function( t, k ) {
            if ( k in t ) return t[k];
            if ( typeof k === "symbol" ) return undefined;
            return function() { return loose( {} ); };
         }
      } );
   }
   function looseClass( init ) {
      return function() {
         var o = {};
         if ( init ) init( o );
         return loose( o );
      };
   }
   R.fakeWindow = function( id, isColor, extra ) {
      var samples = [];
      var view = {
         id: id, fullId: id, isNull: false, samples: samples,
         image: loose( { isColor: !!isColor, width: 400, height: 300,
                         median: function() {
                            if ( opts.median === "throw" ) throw "no statistics";
                            return opts.median;
                         },
                         setSample: function( v, x, y, c ) { samples.push( [ v, x, y, c ] ); } } ),
         beginProcess: function() { view.began = true; },
         endProcess: function() { view.ended = true; },
         // Like PixInsight 1.9.4 + ImageSolver: the solution matrix is the property
         // "AstrometricSolution:LinearTransformationMatrix" (no "PCL:" prefix), a 2x2
         // Matrix read with at( row, col ). solved: "legacy" uses the prefixed name.
         hasProperty: function( name ) {
            if ( opts.solved === "throw" ) throw "property store unavailable";
            if ( !opts.solved ) return false;
            return name === ( opts.solved === "legacy" ? "PCL:" : "" ) + "AstrometricSolution:LinearTransformationMatrix";
         },
         propertyValue: function() {
            var m = opts.solved === "degenerate" ? [ 0, 0, 0, 0 ]
                  : opts.solved === "real" ? [ -0.00033390860916959097, 0.00042235229469336950,   // owner's RASA 8 stack,
                                               -0.00042225020655379310, -0.00033410189680862080 ] //   solver says 1.938 "/px
                  : [ -5e-4, 0, 0, 5e-4 ];                                                       // 1.8 "/px
            return { rows: 2, cols: 2, length: 2, at: function( r, c ) { return m[ 2*r + c ]; } };
         }
      };
      var win = { isNull: false, mainView: view, keywords: opts.keywords || [],
                  maskEnabled: !!opts.masked,
                  hasAstrometricSolution: !!opts.solved,
                  copyAstrometricSolution: function( src ) { win.solutionFrom = src.mainView.id; },
                  show: function() { R.shown.push( id ); },
                  forceClose: function() { delete R.views[id]; } };
      if ( extra ) for ( var k in extra ) win[k] = extra[k];
      view.window = win;
      R.views[id] = win;
      return win;
   };
   R.target = R.fakeWindow( "target", opts.color );

   var NumericControl = function() {
      var o = { value: 0, label: loose( {} ), slider: loose( {} ) };
      o.setValue = function( v ) { o.value = v; };
      return loose( o );
   };
   var ComboBox = function() {
      var o = { currentItem: 0, items: [] };
      o.addItem = function( t ) { o.items.push( t ); };
      return loose( o );
   };
   var CheckBox = looseClass( function( o ) { o.checked = false; } );
   var ViewList = looseClass( function( o ) { o.currentView = null; } );
   var Dialog = function() { R.dialogs.push( this ); };
   Dialog.prototype.execute = function() {
      if ( opts.tweak ) opts.tweak( this );
      return !opts.cancel;
   };
   Dialog.prototype.ok = function() { this.accepted = true; };
   Dialog.prototype.cancel = function() { this.rejected = true; };
   Dialog.prototype.adjustToContents = Dialog.prototype.setMinWidth = function() {};
   Dialog.prototype.font = { width: function( s ) { return 7 * s.length; } };

   function processClass( kind ) {
      var C = function() {};
      // Under V8 (PixInsight 1.9.4) process enums live on the CONSTRUCTOR;
      // the prototype has none (PixelMath.prototype.Gray is undefined).
      // PixelMath values verified in PixInsight 1.9.4: SameAsTarget 0, RGB 1, Gray 2, f32 4.
      C.SameAsTarget = 0; C.RGB = 1; C.Gray = 2; C.f32 = 4;
      C.Parametric = 0; C.Library = 1; C.Image = 2;
      C.prototype = {};
      C.prototype.executeOn = function( view ) {
         R.procs.push( this );
         R.calls.push( kind + " on " + view.id + ( this.expression ? "  expr: " + this.expression : "" )
                       + ( this.expression1 ? " | " + this.expression1 + " | " + this.expression2 : "" )
                       + ( this.viewId ? "  kernel: " + this.viewId : "" )
                       + ( this.createNewImage ? "  -> " + this.newImageId : "" ) );
         if ( opts.failProcess && opts.failProcess( kind, this, view ) === false )
            return false;
         if ( this.createNewImage && !( opts.hideWindow && opts.hideWindow( this.newImageId ) ) )
            R.fakeWindow( this.newImageId, false );
         return true;
      };
      return C;
   }

   var ImageWindow = function( w, h, n, bits, isFloat, isColor, id ) {
      var win = R.fakeWindow( id, isColor );
      win.geometry = [ w, h, n, bits, isFloat, isColor ];
      return win;
   };
   ImageWindow.activeWindow = opts.noActiveWindow ? { isNull: true } : R.target;
   ImageWindow.windowById = function( id ) { return R.views[id] || { isNull: true }; };

   // Like PixInsight 1.9.6: post() returns false on a dead network, it does not throw.
   var NetworkTransfer = function() {
      var t = this;
      t.responseCode = 0;
      t.setURL = function( u ) { t.url = u; };
      t.setConnectionTimeout = function( sec ) { t.timeout = sec; };
      t.setCustomHTTPHeaders = function( h ) { t.headers = h; };
      t.post = function( body ) {
         if ( opts.netThrow ) throw "network stack unavailable";
         R.posts.push( { url: t.url, body: body, headers: t.headers, timeout: t.timeout,
                         discardsReply: typeof t.onDownloadDataAvailable === "function" && t.onDownloadDataAvailable( "x" ) === true } );
         if ( opts.netFail ) return false;
         t.responseCode = opts.netCode || 200;
         return true;
      };
   };

   var env = {
      __cov: cov,
      NetworkTransfer: NetworkTransfer,
      CoreApplication: { ensureMinimumVersion: function( a, b, c ) { R.minVersion = [ a, b, c ]; },
                         versionMajor: 1, versionMinor: 9, versionRelease: 6, versionRevision: 0, platform: "Windows" },
      Console: { show: function() {}, flush: function() {},
                 writeln: function( s ) { R.lines.push( String( s ) ); } },
      Settings: { lastReadOK: false,
                  read: function( k ) {
                     if ( opts.settingsThrow ) throw "settings unavailable";
                     this.lastReadOK = ( k in R.store );
                     return R.store[k];
                  },
                  write: function( k, t, v ) {
                     if ( opts.settingsThrow ) throw "settings unavailable";
                     // Like PixInsight 1.9.4: strings are stored 8-bit, so a
                     // character above U+00FF comes back as its low byte.
                     R.store[k] = ( typeof v === "string" )
                        ? v.replace( /[^\u0000-\u00FF]/g, function( c ) { return String.fromCharCode( c.charCodeAt( 0 ) & 0xFF ); } )
                        : v;
                  } },
      View: { viewById: function( id ) { return R.views[id] ? R.views[id].mainView : null; } },
      ImageWindow: ImageWindow, Dialog: Dialog, NumericControl: NumericControl,
      ComboBox: ComboBox, CheckBox: CheckBox, ViewList: ViewList,
      Label: looseClass(), PushButton: looseClass(), GroupBox: looseClass(),
      HorizontalSizer: looseClass(), VerticalSizer: looseClass(),
      PixelMath: processClass( "PixelMath" ), Convolution: processClass( "Convolution" ),
      TextAlign_Right: 1, TextAlign_VertCenter: 2, UndoFlag_NoSwapFile: 4,
      DataType_Double: 1, DataType_Boolean: 2, DataType_Int32: 3, DataType_String: 4
   };
   R.env = env;
   var names = Object.keys( env );
   // Whatever form the shipped script points at, tests use either none or a fake
   // url (with the shipped field map), so they never post to the real form.
   var code = src
      .replace( /^( {3}url: {3})"[^"]*",/m, opts.telemetry ? '$1"https://forms.example/formResponse",' : '$1"",' );
   var body = code + "\nreturn { " + EXPORTS.map( function( n ) { return n + ": " + n; } ).join( ", " ) + " };";
   try {
      R.x = Function.apply( null, names.concat( [ body ] ) )
                    .apply( null, names.map( function( n ) { return env[n]; } ) );
   } catch ( e ) {
      R.threw = e;
   }
   R.has = function( re ) { return R.lines.some( function( l ) { return re.test( l ); } ); };
   R.temps = function() { return Object.keys( R.views ).filter( function( id ) { return /^oc_/.test( id ); } ); };
   return R;
}

// ---- assertions ------------------------------------------------------------
var failures = 0, passes = 0;
function check( name, ok, detail ) {
   out( ( ok ? "  PASS  " : "  FAIL  " ) + name + ( !ok && detail !== undefined ? "   " + JSON.stringify( detail ) : "" ) );
   if ( ok ) ++passes; else ++failures;
}
function eq( name, got, want ) {
   check( name, JSON.stringify( got ) === JSON.stringify( want ), { got: got, want: want } );
}
function near( name, got, want, tol ) {
   check( name, Math.abs( got - want ) <= tol, { got: got, want: want } );
}
function throws( name, fn, re ) {
   var msg = null;
   try { fn(); } catch ( e ) { msg = String( e && e.message ? e.message : e ); }
   check( name, msg !== null && re.test( msg ), msg );
}

// ============================================================
//  1. End-to-end
// ============================================================
out( "== end to end: mono, defaults, new image ==" );
( function() {
   var R = runScript( { color: false, median: 0.01 } );
   R.lines.forEach( function( l ) { out( "    | " + l ); } );
   R.calls.forEach( function( c ) { out( "    > " + c ); } );
   check( "no exception, no ERROR line", !R.threw && !R.has( /^ERROR/ ), String( R.threw ) );
   eq( "minimum version requested", R.minVersion, [ 1, 9, 4 ] );
   eq( "process sequence", R.calls.map( function( c ) { return c.split( " on " )[0]; } ),
       [ "PixelMath", "Convolution", "PixelMath", "Convolution", "PixelMath" ] );
   check( "result is a new image target_oc", /-> target_oc$/.test( R.calls[4] ) && R.has( /Result\s+: target_oc\s+\(new image\)/ ) );
   check( "the active image is preselected", R.dialogs[0].viewList.currentView === R.target.mainView );
   var write = R.procs[4], extract = R.procs[0];
   eq( "result is clipped to [0,1], not rescaled", [ write.truncate, write.rescale, write.truncateLower, write.truncateUpper ], [ true, false, 0, 1 ] );
   eq( "result is 32-bit float in the target's colour space", [ write.newImageSampleFormat, write.newImageColorSpace, write.showNewImage ], [ 4, 0, true ] );
   eq( "channel copy is neither clipped nor rescaled, hidden, gray", [ extract.truncate, extract.rescale, extract.showNewImage, extract.newImageColorSpace ], [ false, false, false, 2 ] );
   eq( "kernel convolution uses Image mode", R.procs[1].mode, 2 );
   eq( "star-mask blur is a 4 px Gaussian", [ R.procs[3].mode, R.procs[3].sigma, R.procs[3].shape ], [ 0, 4, 2 ] );
   eq( "temporary windows are closed", R.temps(), [] );
   check( "settings were saved", ( KEY + "aperture" ) in R.store && ( KEY + "telescope" ) in R.store );
} )();

out( "== end to end: RGB, RASA 8 from the list, plate-solved, in place, masked, stretched ==" );
( function() {
   var R = runScript( { color: true, median: 0.4, solved: true, masked: true,
      tweak: function( d ) {
         var i = d.telescopeCombo.items.findIndex( function( t ) { return /RASA 8/.test( t ); } );
         d.telescopeCombo.currentItem = i;
         d.applyTelescope( i );
         d.inPlaceBox.checked = true;
      } } );
   R.calls.forEach( function( c ) { out( "    > " + c ); } );
   check( "no exception, no ERROR line", !R.threw && !R.has( /^ERROR/ ), String( R.threw ) );
   check( "telescope logged", R.has( /Telescope\s+: Celestron RASA 8/ ) );
   check( "obstruction from the table", R.has( /obstruction 45\.8 %/ ) );
   check( "scale kept from the plate solution", R.has( /scale 1\.800/ ) );
   check( "stretched-image warning", R.has( /^WARNING: image median is 0\.400/ ) );
   check( "one band per channel", R.has( /bands R\/G\/B/ ) );
   eq( "three kernels built", R.lines.filter( function( l ) { return /^Kernel /.test( l ); } ).length, 3 );
   check( "each channel uses its own kernel",
          /oc_channel_0 {2}kernel: oc_kernel_R/.test( R.calls[1] ) &&
          /oc_channel_1 {2}kernel: oc_kernel_G/.test( R.calls[3] ) &&
          /oc_channel_2 {2}kernel: oc_kernel_B/.test( R.calls[5] ) );
   var last = R.calls[ R.calls.length - 1 ];
   check( "written back in place with star protection",
          /^PixelMath on target {2}expr: min\( 1, 3\*oc_starmask \)\*\$T\[0\]/.test( last ) && !/->/.test( last ) );
   check( "in-place result reported", R.has( /Result\s+: target\s+\(replaced/ ) );
   check( "the user's mask is enabled again", R.target.maskEnabled === true );
   eq( "temporary windows are closed", R.temps(), [] );
   eq( "telescope remembered by maker + model", R.store[ KEY + "telescope" ], "Celestron RASA 8" );
} )();

out( "== end to end: mono narrowband, true mode, no protection, FITS scale ==" );
( function() {
   var R = runScript( { color: false, median: 0.02,
      keywords: [ { name: "FOCALLEN", value: "2032." }, { name: "XPIXSZ", value: "3.76" } ],
      tweak: function( d ) { d.bandCombo.currentItem = 5; d.protectBox.checked = false; d.modeCombo.currentItem = 1; } } );
   check( "no exception, no ERROR line", !R.threw && !R.has( /^ERROR/ ), String( R.threw ) );
   check( "band and mode logged", R.has( /bands Ha {3}exact unobstructed equivalent/ ) );
   check( "scale from FITS keywords", R.has( /scale 0\.382/ ) );
   check( "no star mask built", !R.calls.some( function( c ) { return /starmask/.test( c ); } ) );
   check( "plain write-back expression", /expr: oc_channel_0 {2}-> target_oc$/.test( R.calls[ R.calls.length - 1 ] ) );
} )();

out( "== end to end: RGB, ideal-aperture mode ==" );
( function() {
   var R = runScript( { color: true, median: 0.02,
      tweak: function( d ) { d.modeCombo.currentItem = 2; d.modeCombo.onItemSelected( 2 ); d.maxBoost.setValue( 2.5 ); } } );
   check( "no exception, no ERROR line", !R.threw && !R.has( /^ERROR/ ), String( R.threw ) );
   check( "mode and max boost logged", R.has( /remove all diffraction \(max boost x2\.50\)/ ) );
   eq( "three kernels built", R.lines.filter( function( l ) { return /^Kernel /.test( l ); } ).length, 3 );
   eq( "max boost and mode remembered", [ R.store[ KEY + "mode" ], R.store[ KEY + "maxBoost" ] ], [ 2, 2.5 ] );
} )();

out( "== end to end: Optics = Refractor ==" );
( function() {
   var R = runScript( { color: true, median: 0.02,
      tweak: function( d ) {
         d.aperture.setValue( 80 ); d.scale.setValue( 1.616 );
         d.opticsTypeCombo.currentItem = 1; d.opticsTypeCombo.onItemSelected( 1 );
      } } );
   check( "no exception, no ERROR line", !R.threw && !R.has( /^ERROR/ ), String( R.threw ) );
   check( "the obstruction field (35 %) is ignored: clear aperture logged", R.has( /obstruction 0\.0 % \(clear aperture\)/ ) );
   check( "telescope and mode logged as refractor", R.has( /^Telescope\s+: refractor/ ) && R.has( /refractor: remove diffraction \(max boost x3\.00\)/ ) );
   eq( "optics type remembered", R.store[ KEY + "opticsType" ], 1 );
   eq( "three kernels built", R.lines.filter( function( l ) { return /^Kernel /.test( l ); } ).length, 3 );
   var g = /^Kernel G .*peak boost x([\d.]+)/.exec( R.lines.filter( function( l ) { return /^Kernel G/.test( l ); } )[0] || "" );
   check( "the refractor kernel really boosts (G peak > x1.5)", g && parseFloat( g[1] ) > 1.5, g && g[1] );
   check( "result written", R.has( /Result\s+: target_oc\s+\(new image\)/ ) );
} )();

out( "== end to end: RGB narrowband shares one kernel ==" );
( function() {
   var R = runScript( { color: true, median: 0.02, tweak: function( d ) { d.bandCombo.currentItem = 6; } } );
   eq( "one kernel for three channels", R.lines.filter( function( l ) { return /^Kernel /.test( l ); } ).length, 1 );
   eq( "three channel convolutions use it",
       R.calls.filter( function( c ) { return /kernel: oc_kernel_OIII$/.test( c ); } ).length, 3 );
} )();

// ============================================================
//  2. main(): early exits and error handling
// ============================================================
out( "== main: early exits ==" );
( function() {
   var R = runScript( { cancel: true } );
   check( "cancel: nothing processed", R.calls.length === 0 && !R.has( /^ERROR/ ) );
   check( "cancel: settings not saved", Object.keys( R.store ).length === 0 );

   R = runScript( { tweak: function( d ) { d.viewList.currentView = null; } } );
   check( "no target view: clear error", R.has( /^ERROR: No target image selected/ ) && R.calls.length === 0 );

   R = runScript( { tweak: function( d ) { d.viewList.currentView = { isNull: true }; } } );
   check( "null view object: clear error", R.has( /^ERROR: No target image selected/ ) );

   R = runScript( { median: 0.01, tweak: function( d ) { d.aperture.setValue( 0 ); } } );
   check( "zero aperture rejected", R.has( /^ERROR: aperture, obstruction and image scale/ ) && R.calls.length === 0 );

   R = runScript( { median: 0.01, tweak: function( d ) { d.obstruction.setValue( 100 ); } } );
   check( "100 % obstruction rejected", R.has( /^ERROR: aperture, obstruction and image scale/ ) );

   R = runScript( { median: 0.01, tweak: function( d ) { d.scale.setValue( 0 ); } } );
   check( "zero image scale rejected", R.has( /^ERROR: aperture, obstruction and image scale/ ) );

   R = runScript( { median: 0.01, tweak: function( d ) { d.obstruction.setValue( -5 ); } } );
   check( "negative obstruction rejected", R.has( /^ERROR: aperture, obstruction and image scale/ ) && R.calls.length === 0 );

   R = runScript( { median: 0.01, tweak: function( d ) { d.obstruction.setValue( 0 ); } } );
   check( "0 % obstruction with obstructed optics: nothing to do, points to Optics: Refractor",
          R.has( /^Nothing to do: there is no central obstruction.*Optics: Refractor/ ) && R.calls.length === 0 && !R.has( /^ERROR/ ) );

   R = runScript( { median: 0.01, tweak: function( d ) { d.amount.setValue( 0 ); } } );
   check( "amount 0: nothing to do", R.has( /Amount is 0/ ) && R.calls.length === 0 );

   R = runScript( { median: "throw" } );
   check( "statistics failure is not fatal", !R.has( /^ERROR/ ) && !R.has( /^WARNING/ ) && R.calls.length === 5 );

} )();

out( "== main: failures are reported and cleaned up ==" );
( function() {
   var R = runScript( { median: 0.01, masked: true,
      failProcess: function( kind, p ) { return !( kind === "Convolution" && p.viewId ); } } );
   check( "Convolution returning false -> ERROR line", R.has( /^ERROR: unexpected exception — Convolution failed on oc_channel_0/ ) );
   eq( "temporary windows closed after the failure", R.temps(), [] );
   check( "mask re-enabled after the failure", R.target.maskEnabled === true );
   check( "no result line", !R.has( /Result\s+:/ ) );

   R = runScript( { median: 0.01, failProcess: function( kind ) { if ( kind === "Convolution" ) throw "native boom"; } } );
   check( "native string exception is printed, not 'undefined'", R.has( /^ERROR: unexpected exception — native boom$/ ) );
   eq( "temporary windows closed after a native throw", R.temps(), [] );

   R = runScript( { median: 0.01, failProcess: function( kind, p ) { return !( kind === "PixelMath" && !p.createNewImage ); },
                    tweak: function( d ) { d.inPlaceBox.checked = true; } } );
   check( "in-place write failure reported", R.has( /PixelMath failed while writing the result/ ) );

   R = runScript( { median: 0.01, failProcess: function( kind, p ) { return !( kind === "PixelMath" && /_oc$/.test( p.newImageId || "" ) ); } } );
   check( "new-image write failure reported", R.has( /PixelMath failed while writing the result/ ) );
   eq( "temporary windows closed", R.temps(), [] );

   R = runScript( { median: 0.01, failProcess: function( kind, p ) { return !( kind === "Convolution" && !p.viewId ); } } );
   check( "star-mask blur failure reported", R.has( /Convolution \(Gaussian\) failed on oc_starmask/ ) );
} )();

// ============================================================
//  3. Helpers
// ============================================================
out( "== helpers ==" );
( function() {
   var R = runScript( { cancel: true } ), X = R.x;

   eq( "errText: Error object", X.errText( new Error( "bad" ) ), "bad" );
   eq( "errText: plain string", X.errText( "native text" ), "native text" );
   eq( "errText: null", X.errText( null ), "null" );
   eq( "errText: object without message", X.errText( { code: 3 } ), "[object Object]" );

   var o = {};
   X.trySet( o, "sigma", 2 );
   eq( "trySet sets the property", o.sigma, 2 );
   var locked = {};
   Object.defineProperty( locked, "shape", { set: function() { throw "read-only on this build"; } } );
   X.trySet( locked, "shape", 2 );
   check( "trySet swallows a throwing setter", true );

   eq( "uniqueViewId: free id unchanged", X.uniqueViewId( "fresh" ), "fresh" );
   R.fakeWindow( "taken" ); R.fakeWindow( "taken1" );
   eq( "uniqueViewId: skips taken ids", X.uniqueViewId( "taken" ), "taken2" );

   X.closeWindow( null );
   X.closeWindow( { isNull: true, forceClose: function() { throw "must not be called"; } } );
   X.closeWindow( { isNull: false, forceClose: function() { throw "already closed"; } } );
   check( "closeWindow tolerates null, null-window and a throwing close", true );
   X.closeWindow( R.views[ "taken" ] );
   check( "closeWindow closes a live window", !( "taken" in R.views ) );

   X.log( "hello" );
   eq( "log writes to the console", R.lines[ R.lines.length - 1 ], "hello" );

   R.store[ KEY + "aperture" ] = 203;
   eq( "readSetting: stored value", X.readSetting( "aperture", 1, 99 ), 203 );
   eq( "readSetting: missing -> fallback", X.readSetting( "nope", 1, 99 ), 99 );
   R.store[ KEY + "nullish" ] = null;
   eq( "readSetting: null -> fallback", X.readSetting( "nullish", 1, 7 ), 7 );
   X.writeSetting( "focal", 1, 406 );
   eq( "writeSetting stores under the script key", R.store[ KEY + "focal" ], 406 );

   var T = runScript( { cancel: true, settingsThrow: true } );
   eq( "readSetting: throwing store -> fallback", T.x.readSetting( "aperture", 1, 42 ), 42 );
   T.x.writeSetting( "aperture", 1, 1 );
   check( "writeSetting: throwing store is swallowed", !T.threw );
   check( "dialog still opens with defaults when settings fail", T.dialogs[0].aperture.value === 200 );

   eq( "keywordDict: upper-cases names, strips quotes and spaces",
       X.keywordDict( { keywords: [ { name: " focallen ", value: "'  406. '" }, { name: "XPIXSZ", value: 3.76 } ] } ),
       { FOCALLEN: "406.", XPIXSZ: "3.76" } );
   var bad = {};
   Object.defineProperty( bad, "keywords", { get: function() { throw "no keywords"; } } );
   eq( "keywordDict: unreadable keywords -> empty", X.keywordDict( bad ), {} );

   eq( "mat22: null", X.mat22( null ), null );
   eq( "mat22: flat array", X.mat22( [ 1, 2, 3, 4 ] ), [ 1, 2, 3, 4 ] );
   eq( "mat22: typed array", X.mat22( new Float64Array( [ 1, 2, 3, 4 ] ) ), [ 1, 2, 3, 4 ] );
   eq( "mat22: nested rows", X.mat22( [ [ 1, 2 ], [ 3, 4 ] ] ), [ 1, 2, 3, 4 ] );
   eq( "mat22: short array -> null", X.mat22( [ 1, 2, 3 ] ), null );
   eq( "mat22: Matrix object with at( row, col )",
       X.mat22( { at: function( r, c ) { return 10*r + c; } } ), [ 0, 1, 10, 11 ] );
   eq( "mat22: unknown object -> null", X.mat22( { rows: 2 } ), null );
} )();

out( "== detectImageScale ==" );
( function() {
   var X = runScript( { cancel: true } ).x;
   eq( "no view", X.detectImageScale( null ).scale, null );
   eq( "null view", X.detectImageScale( { isNull: true } ).scale, null );

   var R = runScript( { cancel: true, solved: true,
      keywords: [ { name: "FOCALLEN", value: "406" }, { name: "XPIXSZ", value: "3.76" } ] } );
   var r = R.x.detectImageScale( R.target.mainView );
   near( "plate solution wins: 5e-4 deg/px = 1.8\"/px", r.scale, 1.8, 1e-9 );
   eq( "source is the astrometric solution", r.source, "astrometric solution" );
   eq( "FITS optics still reported", [ r.focalMm, r.pixelUm ], [ 406, 3.76 ] );

   R = runScript( { cancel: true, solved: "real" } );
   r = R.x.detectImageScale( R.target.mainView );
   near( "real ImageSolver matrix (owner's RASA 8 stack) = 1.938\"/px", r.scale, 1.9383, 1e-4 );
   eq( "... read from the solution", r.source, "astrometric solution" );

   R = runScript( { cancel: true, solved: "legacy" } );
   near( "the PCL:-prefixed property name still works", R.x.detectImageScale( R.target.mainView ).scale, 1.8, 1e-9 );

   R = runScript( { cancel: true, solved: "degenerate",
      keywords: [ { name: "FOCALLEN", value: "406" }, { name: "XPIXSZ", value: "3.76" } ] } );
   r = R.x.detectImageScale( R.target.mainView );
   near( "degenerate solution falls back to FITS", r.scale, 1.9102, 1e-3 );
   check( "source names the FITS keywords", /FITS keywords/.test( r.source ) );

   R = runScript( { cancel: true, solved: "throw",
      keywords: [ { name: "FOCALLEN", value: "2032" }, { name: "XPIXSZ", value: "3.76" } ] } );
   near( "throwing property store falls back to FITS", R.x.detectImageScale( R.target.mainView ).scale, 0.3817, 1e-3 );

   R = runScript( { cancel: true, keywords: [ { name: "FOCALLEN", value: "406" } ] } );
   r = R.x.detectImageScale( R.target.mainView );
   eq( "focal length alone is not enough", [ r.scale, r.focalMm, r.pixelUm ], [ null, 406, null ] );

   R = runScript( { cancel: true, keywords: [ { name: "FOCALLEN", value: "n/a" }, { name: "XPIXSZ", value: "-1" } ] } );
   r = R.x.detectImageScale( R.target.mainView );
   eq( "garbage keywords ignored", [ r.scale, r.focalMm, r.pixelUm ], [ null, null, null ] );
   check( "says what to do when nothing is found", /not found/.test( r.source ) );
} )();

// ============================================================
//  4. Processing building blocks
// ============================================================
out( "== processing steps ==" );
( function() {
   var R = runScript( { cancel: true } ), X = R.x;

   var kernel = { size: 3, data: new Float64Array( [ 0, -0.1, 0, -0.1, 1.4, -0.1, 0, -0.1, 0 ] ) };
   var kw = X.createKernelWindow( kernel, "oc_kernel_test" );
   eq( "kernel window geometry: 3x3, 1 channel, 32-bit float, gray", kw.geometry, [ 3, 3, 1, 32, true, false ] );
   eq( "every kernel pixel written once", kw.mainView.samples.length, 9 );
   eq( "centre value at ( 1, 1 ), channel 0", kw.mainView.samples[4], [ 1.4, 1, 1, 0 ] );
   eq( "negative lobe kept as is", kw.mainView.samples[1], [ -0.1, 1, 0, 0 ] );
   check( "written inside a process block", kw.mainView.began && kw.mainView.ended );
   eq( "kernel id is made unique", X.createKernelWindow( kernel, "oc_kernel_test" ).mainView.id, "oc_kernel_test1" );

   var gw = X.pixelMathToNewGray( R.target.mainView, "$T", "oc_gray" );
   eq( "pixelMathToNewGray returns the created window", gw.mainView.id, "oc_gray" );
   check( "PixelMath call recorded", /PixelMath on target {2}expr: \$T {2}-> oc_gray$/.test( R.calls[ R.calls.length - 1 ] ) );

   X.convolveWithKernel( gw.mainView, kw.mainView );
   check( "convolveWithKernel passes the kernel view id", /Convolution on oc_gray {2}kernel: oc_kernel_test$/.test( R.calls[ R.calls.length - 1 ] ) );
   X.gaussianBlur( gw.mainView, 4 );
   check( "gaussianBlur runs without a kernel view", /^Convolution on oc_gray$/.test( R.calls[ R.calls.length - 1 ] ) );

   var F = runScript( { cancel: true, failProcess: function() { return false; } } );
   throws( "pixelMathToNewGray: failed process", function() { F.x.pixelMathToNewGray( F.target.mainView, "$T", "g" ); }, /PixelMath failed for: \$T/ );
   throws( "convolveWithKernel: failed process", function() { F.x.convolveWithKernel( F.target.mainView, { id: "k" } ); }, /Convolution failed on target/ );
   throws( "gaussianBlur: failed process", function() { F.x.gaussianBlur( F.target.mainView, 4 ); }, /Convolution \(Gaussian\) failed on target/ );

   var H = runScript( { cancel: true, hideWindow: function() { return true; } } );
   throws( "pixelMathToNewGray: image not created", function() { H.x.pixelMathToNewGray( H.target.mainView, "$T", "g" ); }, /did not create the image g/ );

   // copyMetadata
   var S = runScript( { cancel: true, solved: true, keywords: [ { name: "FOCALLEN", value: "400" } ] } );
   var to = S.fakeWindow( "copy_target" );
   eq( "copyMetadata: header and solution", S.x.copyMetadata( S.target, to ), [ "FITS keywords", "astrometric solution" ] );
   eq( "... keywords copied", to.keywords, [ { name: "FOCALLEN", value: "400" } ] );
   eq( "... solution copied from the source", to.solutionFrom, "target" );
   var U = runScript( { cancel: true } );
   eq( "copyMetadata: unsolved source -> keywords only", U.x.copyMetadata( U.target, U.fakeWindow( "t2" ) ), [ "FITS keywords" ] );
   eq( "copyMetadata: missing or null window -> nothing", [ U.x.copyMetadata( U.target, null ), U.x.copyMetadata( U.target, { isNull: true } ), U.x.copyMetadata( null, U.target ) ], [ [], [], [] ] );
   var locked = { isNull: false, copyAstrometricSolution: function() { throw "read-only"; } };
   Object.defineProperty( locked, "keywords", { set: function() { throw "read-only"; } } );
   eq( "copyMetadata: native failures are swallowed", S.x.copyMetadata( S.target, locked ), [] );
} )();

out( "== applyCorrection ==" );
( function() {
   function params( R, over ) {
      var p = { view: R.target.mainView, isColor: false, telescope: "custom", apertureMm: 200, eps: 0.35,
                scale: 1.0, bands: [ "L" ], mode: R.x.MODE_RESTORE_ONLY, amount: 1, protect: false,
                satThreshold: 0.95, inPlace: false };
      for ( var k in over ) p[k] = over[k];
      return p;
   }
   var R = runScript( { cancel: true } );
   eq( "returns the new image id", R.x.applyCorrection( params( R ) ), "target_oc" );
   eq( "second run gets a unique id", R.x.applyCorrection( params( R ) ), "target_oc1" );
   eq( "in place returns the target id", R.x.applyCorrection( params( R, { inPlace: true } ) ), "target" );
   eq( "no temporary windows left", R.temps(), [] );

   R = runScript( { cancel: true, solved: true, keywords: [ { name: "XPIXSZ", value: "3.76" } ] } );
   R.x.applyCorrection( params( R ) );
   eq( "new image keeps the FITS header", R.views[ "target_oc" ].keywords, [ { name: "XPIXSZ", value: "3.76" } ] );
   eq( "new image keeps the plate solution", R.views[ "target_oc" ].solutionFrom, "target" );
   check( "metadata copy is logged", R.has( /^Metadata\s+: copied FITS keywords and astrometric solution/ ) );
   R.x.applyCorrection( params( R, { inPlace: true } ) );
   eq( "in place: nothing to copy", R.target.solutionFrom, undefined );

   R = runScript( { cancel: true } );
   R.x.applyCorrection( params( R, { protect: true, satThreshold: 0.9 } ) );
   check( "threshold goes into the mask expression",
          R.calls.some( function( c ) { return /iif\( \$T >= 0\.9000, 1, 0 \) {2}-> oc_starmask/.test( c ); } ) );

   R = runScript( { cancel: true, color: true } );
   R.x.applyCorrection( params( R, { isColor: true, bands: [ "R", "G", "B" ], protect: true } ) );
   check( "colour mask uses the brightest channel",
          R.calls.some( function( c ) { return /iif\( max\( \$T\[0\], \$T\[1\], \$T\[2\] \) >= 0\.9500/.test( c ); } ) );
   var last = R.calls[ R.calls.length - 1 ];
   check( "colour write-back has three expressions", last.split( " | " ).length === 3 && /oc_channel_2/.test( last ) );

   var maskLog = [];
   R = runScript( { cancel: true, masked: true } );
   var win = R.target, state = true;
   Object.defineProperty( win, "maskEnabled", {
      get: function() { return state; },
      set: function( v ) { state = v; maskLog.push( v ); } } );
   R.x.applyCorrection( params( R, { inPlace: true } ) );
   eq( "mask: off for the temporaries, on for the write-back, on at the end", maskLog, [ false, true, true ] );

   maskLog = []; state = true;
   R.x.applyCorrection( params( R ) );
   eq( "mask: off while working, restored at the end (new image)", maskLog, [ false, true ] );

   R = runScript( { cancel: true } );
   Object.defineProperty( R.target, "maskEnabled", { get: function() { throw "no mask support"; } } );
   eq( "window without mask support still works", R.x.applyCorrection( params( R ) ), "target_oc" );
} )();

// ============================================================
//  5. Dialog
// ============================================================
out( "== dialog ==" );
( function() {
   var R = runScript( { cancel: true, color: false } ), X = R.x;
   var d = new X.ObstructionCorrectionDialog();

   eq( "list = Custom + every obstructed telescope", d.telescopeCombo.items.length, 1 + X.obstructedOptics( X.OPTICS ).length );
   eq( "first entry is Custom", d.telescopeCombo.items[0], "Custom (enter values below)" );
   check( "no unobstructed optics in the list", !d.telescopeCombo.items.some( function( t ) { return /, 0%$/.test( t ); } ) );
   eq( "band list = Auto + every band", d.bandCombo.items.length, 1 + X.BANDS.length );
   eq( "defaults", [ d.aperture.value, d.obstruction.value, d.focal.value, d.pixel.value, d.amount.value ],
       [ 200, 35, 800, 3.76, 1 ] );
   check( "protection on, in-place off by default", d.protectBox.checked === true && d.inPlaceBox.checked === false );
   near( "scale derived from focal length and pixel size", d.scale.value, X.imageScaleArcsec( 800, 3.76 ), 1e-9 );
   check( "scale source shown", /focal length and pixel size/.test( d.scaleSource.text ) );
   check( "read-out filled in", /Largest contrast boost/.test( d.readout.text ) );

   // applyTelescope
   var before = [ d.aperture.value, d.obstruction.value, d.focal.value ];
   d.applyTelescope( 0 ); d.applyTelescope( -1 ); d.applyTelescope( 99 );
   eq( "applyTelescope ignores Custom and out-of-range", [ d.aperture.value, d.obstruction.value, d.focal.value ], before );
   var iEdge = d.telescopeCombo.items.findIndex( function( t ) { return /EdgeHD/.test( t ); } );
   d.telescopeCombo.currentItem = iEdge;
   d.telescopeCombo.onItemSelected( iEdge );
   eq( "picking EdgeHD 8 fills aperture and focal length", [ d.aperture.value, d.focal.value ], [ 203, 2032 ] );
   near( "and its obstruction", d.obstruction.value, 33.9, 1e-9 );
   near( "and recomputes the scale", d.scale.value, X.imageScaleArcsec( 2032, 3.76 ), 1e-9 );
   eq( "parameters() carries the telescope label", d.parameters().telescope, d.telescopeCombo.items[ iEdge ] );

   // manual edits
   d.aperture.setValue( 210 ); d.aperture.onValueUpdated( 210 );
   eq( "editing the aperture switches the list to Custom", d.telescopeCombo.currentItem, 0 );
   eq( "parameters() then says custom", d.parameters().telescope, "custom" );
   d.telescopeCombo.currentItem = iEdge;
   d.obstruction.setValue( 30 ); d.obstruction.onValueUpdated( 30 );
   eq( "editing the obstruction switches to Custom", d.telescopeCombo.currentItem, 0 );
   d.telescopeCombo.currentItem = iEdge;
   d.focal.setValue( 1000 ); d.focal.onValueUpdated( 1000 );
   eq( "editing the focal length switches to Custom", d.telescopeCombo.currentItem, 0 );
   near( "and updates the scale", d.scale.value, X.imageScaleArcsec( 1000, 3.76 ), 1e-9 );
   d.pixel.setValue( 7.52 ); d.pixel.onValueUpdated( 7.52 );
   near( "editing the pixel size updates the scale", d.scale.value, X.imageScaleArcsec( 1000, 7.52 ), 1e-9 );
   d.scale.setValue( 2.5 ); d.scale.onValueUpdated( 2.5 );
   check( "typing a scale marks it manual", /entered manually/.test( d.scaleSource.text ) && d.scaleOrigin === "" );

   // scale origin
   d.scaleOrigin = "solution";
   d.scale.setValue( 1.234 );
   d.scaleFromOptics();
   eq( "a plate-solved scale is not overwritten by the optics", d.scale.value, 1.234 );
   d.focal.setValue( 500 ); d.focal.onValueUpdated( 500 );
   eq( "nor by a typed focal length", [ d.scale.value, d.scaleOrigin ], [ 1.234, "solution" ] );
   d.focal.setValue( 1000 );
   d.scaleOrigin = "";
   d.scaleFromOptics();
   near( "no image scale: scale follows the optics", d.scale.value, X.imageScaleArcsec( 1000, 7.52 ), 1e-9 );

   // bands / parameters
   d.bandCombo.currentItem = 0;
   eq( "auto band, mono", d.bandIds( false ), [ "L" ] );
   eq( "auto band, colour", d.bandIds( true ), [ "R", "G", "B" ] );
   d.bandCombo.currentItem = 5; d.bandCombo.onItemSelected( 5 );
   eq( "explicit band, mono", d.bandIds( false ), [ "Ha" ] );
   eq( "explicit band, colour", d.bandIds( true ), [ "Ha", "Ha", "Ha" ] );
   d.modeCombo.currentItem = 1; d.modeCombo.onItemSelected( 1 );
   d.obstruction.setValue( 40 ); d.amount.setValue( 0.5 ); d.amount.onValueUpdated( 0.5 );
   d.satThreshold.setValue( 0.9 ); d.satThreshold.onValueUpdated( 0.9 );
   d.protectBox.checked = false; d.inPlaceBox.checked = true;
   d.viewList.currentView = R.target.mainView;
   var p = d.parameters();
   eq( "parameters(): numbers", [ p.apertureMm, p.eps, p.scale, p.amount, p.satThreshold ], [ 210, 0.4, d.scale.value, 0.5, 0.9 ] );
   eq( "parameters(): flags", [ p.isColor, p.protect, p.inPlace, p.mode ], [ false, false, true, X.MODE_TRUE_EQUIVALENT ] );
   check( "parameters(): view", p.view === R.target.mainView );
   d.modeCombo.currentItem = 0;
   eq( "parameters(): restore-only mode", d.parameters().mode, X.MODE_RESTORE_ONLY );
   d.viewList.currentView = null;
   eq( "parameters(): no view -> mono, null view", [ d.parameters().isColor, d.parameters().view ], [ false, null ] );

   // ideal-aperture mode and its Max boost control
   eq( "three modes in the list, plain names", d.modeCombo.items, X.MODE_ITEMS );
   d.modeCombo.currentItem = 0; d.modeCombo.onItemSelected( 0 );
   check( "Max boost is hidden outside diffraction removal", d.maxBoost.visible === false );
   check( "restore mode is described", /secondary mirror takes away/.test( d.modeDescription.text ), d.modeDescription.text );
   d.modeCombo.currentItem = 1; d.modeCombo.onItemSelected( 1 );
   check( "exact-equivalent mode is described", /exactly what an unobstructed telescope/.test( d.modeDescription.text ) );
   d.modeCombo.currentItem = 2; d.modeCombo.onItemSelected( 2 );
   check( "... and shown in it", d.maxBoost.visible === true );
   check( "diffraction-removal mode is described", /removes the aperture's own diffraction blur/.test( d.modeDescription.text ) );
   d.maxBoost.setValue( 4 ); d.maxBoost.onValueUpdated( 4 );
   eq( "parameters(): ideal mode and max boost", [ d.parameters().mode, d.parameters().maxBoost ], [ X.MODE_IDEAL_APERTURE, 4 ] );
   d.amount.setValue( 1 ); d.obstruction.setValue( 46 ); d.aperture.setValue( 203 ); d.scale.setValue( 1.938 ); d.bandCombo.currentItem = 0;
   d.updateReadout();
   var mIdeal = /Largest contrast boost: <b>&times;([\d.]+)/.exec( d.readout.text );
   d.modeCombo.currentItem = 0; d.modeCombo.onItemSelected( 0 );
   var mRestore = /Largest contrast boost: <b>&times;([\d.]+)/.exec( d.readout.text );
   check( "read-out: ideal mode shows a bigger boost than restore-only",
          mIdeal && mRestore && parseFloat( mIdeal[1] ) > parseFloat( mRestore[1] ), [ mIdeal && mIdeal[1], mRestore && mRestore[1] ] );
   check( "Max boost hidden again", d.maxBoost.visible === false );
   d.modeCombo.currentItem = 7;
   eq( "an unknown combo index means restore-only", d.parameters().mode, X.MODE_RESTORE_ONLY );
   d.modeCombo.currentItem = 0;

   // 0 % with obstructed optics: hint to choose Optics: Refractor
   d.obstruction.setValue( 0 ); d.obstruction.onValueUpdated( 0 );
   check( "read-out: 0 % obstruction points to Optics: Refractor",
          /No obstruction entered: for a refractor choose Optics: Refractor/.test( d.readout.text ), d.readout.text );
   d.obstruction.setValue( 46 );

   // Optics: Refractor
   eq( "two optics types", d.opticsTypeCombo.items.length, 2 );
   check( "obstructed optics: telescope, obstruction and mode visible",
          d.telescopeCombo.visible && d.telescopeLabel.visible && d.obstruction.visible && d.modeCombo.visible && d.modeLabel.visible );
   d.modeCombo.currentItem = 0;
   d.opticsTypeCombo.currentItem = 1; d.opticsTypeCombo.onItemSelected( 1 );
   check( "refractor: telescope list, obstruction and mode hidden",
          !d.telescopeCombo.visible && !d.telescopeLabel.visible && !d.obstruction.visible && !d.modeCombo.visible && !d.modeLabel.visible );
   check( "refractor: Max boost shown, refractor text", d.maxBoost.visible === true && /^<p><b>Refractor:/.test( d.modeDescription.text ) );
   var pr = d.parameters();
   eq( "refractor: obstruction 0, diffraction removal, labelled", [ pr.eps, pr.mode, pr.refractor, pr.telescope ],
       [ 0, X.MODE_IDEAL_APERTURE, true, "refractor" ] );
   check( "refractor read-out: a real boost, no hint", !/No obstruction/.test( d.readout.text ) && !/&times;1\.00/.test( d.readout.text ), d.readout.text );
   d.opticsTypeCombo.currentItem = 0; d.opticsTypeCombo.onItemSelected( 0 );
   check( "back to obstructed: everything visible again, the chosen mode applies",
          d.obstruction.visible && d.modeCombo.visible && d.parameters().mode === X.MODE_RESTORE_ONLY && d.parameters().eps > 0 );

   // read-out
   d.amount.setValue( 0 ); d.updateReadout();
   check( "read-out notes when there is nothing to correct", /Almost nothing to correct/.test( d.readout.text ) );
   check( "noise shown as +0% at amount 0", /Background noise: <b>\+0%/.test( d.readout.text ) );
   d.amount.setValue( 1 ); d.modeCombo.currentItem = 1; d.obstruction.setValue( 35 ); d.scale.setValue( 0.15 );
   d.updateReadout();
   check( "negative noise change has no plus sign (oversampled, true mode)", /Background noise: <b>-\d+%/.test( d.readout.text ), d.readout.text );
   var keep = d.parameters;
   d.parameters = function() { throw new Error( "boom" ); };
   d.updateReadout();
   eq( "read-out is cleared, not crashed, on an internal error", d.readout.text, "" );
   d.parameters = keep;

   // buttons
   d.ok_Button.onClick(); d.cancel_Button.onClick();
   check( "Run and Cancel buttons are wired", d.accepted === true && d.rejected === true );

   // view change re-detects the scale
   var S = runScript( { cancel: true, solved: true, keywords: [ { name: "XPIXSZ", value: "2.9" } ] } );
   var ds = new S.x.ObstructionCorrectionDialog();
   check( "active image picked up", ds.viewList.currentView === S.target.mainView );
   near( "solved image: scale from the solution", ds.scale.value, 1.8, 1e-9 );
   check( "solved image: scale locked", ds.scaleOrigin === "solution" && /astrometric solution/.test( ds.scaleSource.text ) );
   eq( "pixel size taken from XPIXSZ", ds.pixel.value, 2.9 );
   ds.scale.setValue( 9 ); ds.scaleOrigin = "";
   ds.viewList.onViewSelected( S.target.mainView );
   near( "selecting a view re-reads its scale", ds.scale.value, 1.8, 1e-9 );
   ds.viewList.currentView = null;
   ds.detectScale();
   check( "no view: falls back to the optics and unlocks", ds.scaleOrigin === "" && /focal length and pixel size/.test( ds.scaleSource.text ) );

   // FITS keywords (as on the owner's RASA 8 stack: FOCALLEN 400, XPIXSZ 3.76)
   var F = runScript( { cancel: true, keywords: [ { name: "FOCALLEN", value: "400" }, { name: "XPIXSZ", value: "3.76" } ] } );
   var df = new F.x.ObstructionCorrectionDialog();
   eq( "FITS: focal length and pixel size fill the fields", [ df.focal.value, df.pixel.value, df.scaleOrigin ], [ 400, 3.76, "fits" ] );
   near( "FITS: scale from the keywords", df.scale.value, F.x.imageScaleArcsec( 400, 3.76 ), 1e-9 );
   var iR8 = df.telescopeCombo.items.findIndex( function( t ) { return /RASA 8/.test( t ); } );
   df.telescopeCombo.currentItem = iR8; df.telescopeCombo.onItemSelected( iR8 );
   eq( "FITS: picking a telescope fills aperture and obstruction ...", [ df.aperture.value, Math.round( df.obstruction.value ) ], [ 203, 46 ] );
   eq( "... but keeps the image's focal length and scale", [ df.focal.value, df.scaleOrigin ], [ 400, "fits" ] );
   near( "... scale unchanged", df.scale.value, F.x.imageScaleArcsec( 400, 3.76 ), 1e-9 );
   check( "... and the source still says FITS", /FITS keywords/.test( df.scaleSource.text ) );
   df.pixel.setValue( 7.52 ); df.pixel.onValueUpdated( 7.52 );
   eq( "FITS: a typed pixel size overrides the keywords", df.scaleOrigin, "" );
   near( "... and recomputes the scale", df.scale.value, F.x.imageScaleArcsec( 400, 7.52 ), 1e-9 );

   var N = runScript( { cancel: true, noActiveWindow: true } );
   eq( "no open image: nothing preselected", N.dialogs[0].viewList.currentView, null );
} )();

out( "== dialog settings ==" );
( function() {
   var R = runScript( { cancel: true } ), X = R.x;
   var d = new X.ObstructionCorrectionDialog();
   var iRasa = d.telescopeCombo.items.findIndex( function( t ) { return /RASA 11/.test( t ); } );
   d.telescopeCombo.currentItem = iRasa; d.applyTelescope( iRasa );
   d.pixel.setValue( 4.63 ); d.amount.setValue( 0.7 ); d.satThreshold.setValue( 0.8 );
   d.protectBox.checked = false; d.inPlaceBox.checked = true;
   d.modeCombo.currentItem = 1; d.bandCombo.currentItem = 6; d.maxBoost.setValue( 5 );
   d.saveSettings();
   eq( "saved values", [ R.store[ KEY + "aperture" ], R.store[ KEY + "focal" ], R.store[ KEY + "pixel" ],
                         R.store[ KEY + "amount" ], R.store[ KEY + "satThreshold" ], R.store[ KEY + "protect" ],
                         R.store[ KEY + "inPlace" ], R.store[ KEY + "mode" ], R.store[ KEY + "band" ] ],
       [ 279, 620, 4.63, 0.7, 0.8, false, true, 1, 6 ] );
   eq( "telescope saved by maker + model", R.store[ KEY + "telescope" ], "Celestron RASA 11" );

   var d2 = new X.ObstructionCorrectionDialog();            // same fake store
   eq( "a new dialog restores them",
       [ d2.aperture.value, d2.focal.value, d2.pixel.value, d2.amount.value, d2.satThreshold.value,
         d2.protectBox.checked, d2.inPlaceBox.checked, d2.modeCombo.currentItem, d2.bandCombo.currentItem,
         d2.telescopeCombo.currentItem ],
       [ 279, 620, 4.63, 0.7, 0.8, false, true, 1, 6, iRasa ] );
   eq( "max boost restored", d2.maxBoost.value, 5 );
   R.store[ KEY + "mode" ] = 2;
   var di = new X.ObstructionCorrectionDialog();
   check( "diffraction-removal mode restored, Max boost shown", di.modeCombo.currentItem === 2 && di.maxBoost.visible === true );
   R.store[ KEY + "opticsType" ] = 1;
   var dr = new X.ObstructionCorrectionDialog();
   check( "refractor restored: obstruction hidden", dr.opticsTypeCombo.currentItem === 1 && dr.obstruction.visible === false );
   R.store[ KEY + "opticsType" ] = 9;
   eq( "unknown optics type falls back to obstructed", new X.ObstructionCorrectionDialog().opticsTypeCombo.currentItem, 0 );
   delete R.store[ KEY + "opticsType" ];

   d.telescopeCombo.currentItem = 0;
   d.saveSettings();
   eq( "Custom is saved as an empty key", R.store[ KEY + "telescope" ], "" );

   R.store[ KEY + "telescope" ] = "A telescope that was removed from the table";
   R.store[ KEY + "band" ] = 99; R.store[ KEY + "mode" ] = 7;
   var d3 = new X.ObstructionCorrectionDialog();
   eq( "unknown telescope, band and mode fall back safely",
       [ d3.telescopeCombo.currentItem, d3.bandCombo.currentItem, d3.modeCombo.currentItem ], [ 0, 0, 0 ] );
   R.store[ KEY + "band" ] = -1;
   eq( "negative band index falls back", new X.ObstructionCorrectionDialog().bandCombo.currentItem, 0 );
} )();

out( "== usage statistics (telemetry) ==" );
( function() {
   var KEYS = [ "event", "script", "pi", "os", "install", "optics", "telescope", "aperture_mm", "obstruction_pct",
                "scale_arcsec", "scale_source", "color", "bands", "mode", "amount", "max_boost", "protect_stars",
                "in_place", "megapixels", "seconds", "error" ];
   // Decode a posted body back into { key: value } with the script's own field map.
   function record( R ) {
      var post = R.posts[0];
      if ( !post ) return null;
      var byEntry = {}, fields = R.x.TELEMETRY.fields, rec = {};
      for ( var k in fields ) byEntry[ fields[k] ] = k;
      post.body.split( "&" ).forEach( function( pair ) {
         var i = pair.indexOf( "=" );
         rec[ byEntry[ pair.substr( 0, i ) ] || ( "?" + pair.substr( 0, i ) ) ] = decodeURIComponent( pair.substr( i + 1 ) );
      } );
      return rec;
   }
   function silent( R ) { return !R.has( /usage statistics|Usage statistics/i ); }

   // the shipped form: well-formed url, one distinct entry per column
   var X0 = runScript( { cancel: true, telemetry: true } ).x;
   var shippedUrl = ( /^ {3}url: {3}"([^"]*)",/m.exec( src ) || [] )[1];
   check( "shipped form url is a Google Form formResponse (or empty)",
          shippedUrl === "" || /^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/formResponse$/.test( shippedUrl ), shippedUrl );
   eq( "one form field per column, in order", Object.keys( X0.TELEMETRY.fields ), KEYS );
   var ids = KEYS.map( function( k ) { return X0.TELEMETRY.fields[k]; } );
   check( "every field is entry.<number>", ids.every( function( v ) { return /^entry\.\d+$/.test( v ); } ), ids );
   eq( "field ids are distinct", ids.filter( function( v, i ) { return ids.indexOf( v ) === i; } ).length, KEYS.length );

   // not configured (empty url): no checkbox, nothing sent
   var R = runScript( { color: true, median: 0.02 } );
   eq( "not configured: nothing posted", R.posts.length, 0 );
   check( "not configured: checkbox hidden", R.dialogs[0].telemetryBox.visible === false );

   // configured, default on, RGB run with RASA 8 from the list
   R = runScript( { color: true, median: 0.02, telemetry: true,
      keywords: [ { name: "FOCALLEN", value: "400" }, { name: "XPIXSZ", value: "3.76" }, { name: "OBJECT", value: "M 64" },
                  { name: "SITELAT", value: "50.45" } ],
      tweak: function( d ) {
         var i = d.telescopeCombo.items.findIndex( function( t ) { return /RASA 8/.test( t ); } );
         d.telescopeCombo.currentItem = i; d.applyTelescope( i );
      } } );
   check( "configured: no exception", !R.threw && !R.has( /^ERROR/ ), String( R.threw ) );
   check( "configured: checkbox shown and ticked by default", R.dialogs[0].telemetryBox.visible === true && R.dialogs[0].telemetryBox.checked === true );
   eq( "one record posted", R.posts.length, 1 );
   var post = R.posts[0];
   eq( "posted to the form, form-encoded, 4 s timeout, reply discarded",
       [ post.url, post.headers, post.timeout, post.discardsReply ],
       [ "https://forms.example/formResponse", [ "Content-Type: application/x-www-form-urlencoded" ], 4, true ] );
   check( "nothing about statistics in the console", silent( R ) );
   var rec = record( R );
   eq( "row: event, versions, platform", [ rec.event, rec.script, rec.pi, rec.os ], [ "run", R.x.VERSION, "1.9.6-0", "Windows" ] );
   check( "row: install id is 16 hex digits and stored", /^[0-9a-f]{16}$/.test( rec.install ) && R.store[ KEY + "installId" ] === rec.install );
   eq( "row: optics columns", [ rec.optics, rec.telescope, rec.aperture_mm, rec.obstruction_pct, rec.scale_arcsec, rec.scale_source ],
       [ "obstructed", "Celestron RASA 8", "203", "45.8", "1.939", "fits" ] );
   eq( "row: correction columns, readable values", [ rec.color, rec.bands, rec.mode, rec.amount, rec.max_boost, rec.protect_stars, rec.in_place ],
       [ "RGB", "R/G/B", "restore obstruction loss", "1", undefined, "yes", "no" ] );
   check( "row: size and run time are plain numbers", rec.megapixels === "0.1" && /^\d+(\.\d)?$/.test( rec.seconds ), [ rec.megapixels, rec.seconds ] );
   check( "row: only known columns are sent", Object.keys( rec ).every( function( k ) { return KEYS.indexOf( k ) >= 0; } ), Object.keys( rec ) );
   var raw = decodeURIComponent( post.body );
   check( "row: no image ids, keywords, object or site", !/target|M 64|OBJECT|SITELAT|50\.45|FOCALLEN/.test( raw ), raw );
   eq( "telemetry choice remembered", R.store[ KEY + "telemetry" ], true );

   // the same installation keeps its id
   var R2 = runScript( { color: false, median: 0.02, telemetry: true, store: R.store } );
   eq( "install id is stable across runs", record( R2 ).install, rec.install );
   eq( "mono is written as mono", record( R2 ).color, "mono" );

   // refractor, diffraction removal
   R = runScript( { color: false, median: 0.02, telemetry: true,
      tweak: function( d ) { d.opticsTypeCombo.currentItem = 1; d.opticsTypeCombo.onItemSelected( 1 ); d.maxBoost.setValue( 1.5 ); } } );
   rec = record( R );
   eq( "refractor row", [ rec.optics, rec.telescope, rec.obstruction_pct, rec.mode, rec.max_boost, rec.bands, rec.scale_source ],
       [ "refractor", "refractor", "0", "refractor: remove diffraction", "1.5", "L", "fields" ] );

   // switched off in the dialog: nothing sent
   R = runScript( { color: true, median: 0.02, telemetry: true, tweak: function( d ) { d.telemetryBox.checked = false; } } );
   eq( "unticked: nothing posted", R.posts.length, 0 );
   eq( "unticked choice remembered", R.store[ KEY + "telemetry" ], false );

   // cancelled dialog: nothing sent
   eq( "cancelled: nothing posted", runScript( { cancel: true, telemetry: true } ).posts.length, 0 );

   // network down / refused / native throw: the run still succeeds, silently
   R = runScript( { color: true, median: 0.02, telemetry: true, netFail: true } );
   check( "offline: run succeeds, nothing in the console", !R.has( /^ERROR/ ) && R.has( /Result\s+: target_oc/ ) && silent( R ) );
   R = runScript( { color: true, median: 0.02, telemetry: true, netCode: 403 } );
   check( "HTTP 403: run succeeds, silent", !R.has( /^ERROR/ ) && silent( R ) );
   check( "HTTP 403 counts as not accepted", R.x.reportUsage( null, { event: "run" } ) === false );
   R = runScript( { color: true, median: 0.02, telemetry: true, netThrow: true } );
   check( "native throw: swallowed, run succeeds, silent", !R.threw && !R.has( /^ERROR/ ) && silent( R ) );
   check( "accepted record reports true", runScript( { cancel: true, telemetry: true } ).x.reportUsage( null, { event: "run" } ) === true );

   // a failed run is reported with its (scrubbed) error
   R = runScript( { color: false, median: 0.02, telemetry: true,
      failProcess: function( kind ) { if ( kind === "Convolution" ) throw "Convolution failed reading E:\\2026\\RedCat91\\M 64\\stack.xisf"; } } );
   rec = record( R );
   check( "error run: the error is still shown", R.has( /^ERROR: unexpected exception/ ) );
   eq( "error row: event and parameters", [ rec && rec.event, rec && rec.mode ], [ "error", "restore obstruction loss" ] );
   check( "error row: path with spaces fully scrubbed", rec && rec.error === "Convolution failed reading <path>", rec && rec.error );

   // helpers
   var X = runScript( { cancel: true } ).x;
   eq( "scrubText: quoted path with a space, unquoted Unix path", X.scrubText( 'open "C:/data/a b.xisf" and /home/me/x.fits failed' ),
       'open "<path>" and <path>' );
   eq( "scrubText: unquoted Windows path with spaces runs to the end of the line",
       X.scrubText( "cannot read E:\\2026\\M 64\\a.xisf\nnext line" ), "cannot read <path>\nnext line" );
   eq( "scrubText: text without paths is kept", X.scrubText( "PixelMath failed while writing the result" ), "PixelMath failed while writing the result" );
   eq( "scrubText: at most 300 characters", X.scrubText( new Array( 500 ).join( "x" ) ).length, 300 );
   eq( "round", [ X.round( 1.23456, 2 ), X.round( 45.849, 1 ) ], [ 1.23, 45.8 ] );
   eq( "yesNo", [ X.yesNo( true ), X.yesNo( 0 ) ], [ "yes", "no" ] );
   eq( "telemetryRecord without parameters (early failure)", Object.keys( X.telemetryRecord( null, { event: "error", error: "boom" } ) ),
       [ "event", "script", "pi", "os", "install", "error" ] );
   eq( "telemetryBody: known keys only, encoded, in field order",
       X.telemetryBody( { error: "a&b=c", event: "run", junk: "x", amount: 0.5, max_boost: undefined } ),
       X.TELEMETRY.fields.event + "=run&" + X.TELEMETRY.fields.amount + "=0.5&" + X.TELEMETRY.fields.error + "=a%26b%3Dc" );
   check( "sendTelemetry is a no-op when not configured", X.sendTelemetry( { event: "run" } ) === false );
   check( "configuration format is checked", ( function() {
      var keep = X.TELEMETRY.fields.event;
      X.TELEMETRY.url = "https://f/formResponse"; X.TELEMETRY.fields.event = "entry.x";
      var bad = X.telemetryConfigured();
      X.TELEMETRY.fields.event = keep;
      var good = X.telemetryConfigured();
      X.TELEMETRY.url = "";
      return !bad && good;
   } )() );
   var S = runScript( { cancel: true, store: {} } );
   S.store[ KEY + "installId" ] = "not-an-id";
   check( "a damaged install id is replaced", /^[0-9a-f]{16}$/.test( S.x.installId() ) && S.store[ KEY + "installId" ] !== "not-an-id" );
} )();

out( "== mode names and descriptions ==" );
( function() {
   var X = runScript( { cancel: true } ).x;
   eq( "log names", [ X.modeName( X.MODE_RESTORE_ONLY, false ), X.modeName( X.MODE_TRUE_EQUIVALENT, false ),
                      X.modeName( X.MODE_IDEAL_APERTURE, false ), X.modeName( X.MODE_RESTORE_ONLY, true ) ],
       [ "restore obstruction loss", "exact unobstructed equivalent", "remove all diffraction", "refractor: remove diffraction" ] );
   var texts = [ X.modeDescription( 0, false ), X.modeDescription( 1, false ), X.modeDescription( 2, false ), X.modeDescription( 0, true ) ];
   eq( "four different descriptions", texts.filter( function( t, i ) { return texts.indexOf( t ) === i; } ).length, 4 );
   check( "descriptions are rich-text paragraphs", texts.every( function( t ) { return /^<p>.*<\/p>$/.test( t ); } ) );
   check( "experimental modes say so", /Experimental/.test( texts[2] ) && /Experimental/.test( texts[3] ) && !/Experimental/.test( texts[0] ) );
} )();

out( "== portable functions the pipeline does not call ==" );
( function() {
   var X = runScript( { cancel: true } ).x;
   near( "obstructionGain", X.obstructionGain( 0.3, 0.35 ), 1.416, 0.001 );
   var k = X.buildKernel( [ 1.35 ], 0.35, X.MODE_TRUE_EQUIVALENT, 1, 49 );
   near( "kernelResponse at DC is 1", X.kernelResponse( k, 0 ), 1, 1e-9 );
   near( "ideal kernel: response at DC is 1", X.kernelResponse( X.buildKernel( [ 1.35 ], 0.35, X.MODE_IDEAL_APERTURE, 1, 49 ), 0 ), 1, 1e-9 );
   X.main();
   check( "main() can be called again (cancelled)", true );
} )();

// ============================================================
//  6. Coverage: every named function / method was entered
// ============================================================
out( "== function coverage ==" );
var all = Object.keys( declared ).sort();
var missed = all.filter( function( n ) { return !entered[n]; } );
out( "  INFO  " + ( all.length - missed.length ) + " of " + all.length + " named functions and methods entered" );
check( "every function and method is exercised", missed.length === 0, missed );
check( "the instrumentation found the script's functions", all.length > 40, all.length );

out( "" );
out( passes + " checks passed, " + failures + " failed" );
out( failures === 0 ? "MOCK TESTS PASSED (fake PixInsight — not proof of real behaviour)"
                    : failures + " MOCK TEST(S) FAILED" );
exitWith( failures === 0 ? 0 : 1 );
