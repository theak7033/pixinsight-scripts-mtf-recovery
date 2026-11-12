// ============================================================
// tools/smoketest.js — runs the WHOLE script against a fake PixInsight.
//
// Run:  tools/test.sh
//
// Every PixInsight global is replaced by a permissive stub, the dialog is
// "accepted" automatically and the full pipeline executes. This catches
// plain JavaScript slips (typos, undefined names, wrong call order) and
// shows which process expressions the script would issue.
//
// It does NOT prove the script works in PixInsight: the stubs accept any
// property or method, so a wrong PixInsight API name passes here.
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
var src = readText( SCRIPT ).split( "\n" ).map( function( l ) {
   return /^#/.test( l ) ? "" : l;
} ).join( "\n" );

function runCase( name, opts ) {
   var consoleLines = [], calls = [], views = {}, closed = 0;

   // A stub that swallows any property write and answers any call.
   function loose( target ) {
      return new Proxy( target, {
         get: function( t, k ) {
            if ( k in t ) return t[k];
            if ( typeof k === "symbol" ) return undefined;
            var f = function() { return loose( {} ); };
            return f;
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
   function fakeWindow( id, isColor ) {
      var view = {
         id: id, fullId: id, isNull: false,
         image: loose( { isColor: !!isColor, width: 400, height: 300,
                         median: function() { return opts.median; },
                         setSample: function() {} } ),
         beginProcess: function() {}, endProcess: function() {},
         hasProperty: function( p ) { return !!opts.solved; },
         propertyValue: function() { return [ -5e-4, 0, 0, 5e-4 ]; }   // 1.8 "/px
      };
      var win = { isNull: false, mainView: view, keywords: opts.keywords || [],
                  maskEnabled: !!opts.masked, show: function() {},
                  forceClose: function() { ++closed; delete views[id]; } };
      view.window = win;
      views[id] = win;
      return win;
   }
   var target = fakeWindow( "target", opts.color );

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
   var ViewList = looseClass( function( o ) { o.currentView = target.mainView; } );
   var Dialog = function() {};
   Dialog.prototype.execute = function() {
      if ( opts.tweak ) opts.tweak( this );
      return true;
   };
   Dialog.prototype.ok = Dialog.prototype.cancel = Dialog.prototype.adjustToContents =
      Dialog.prototype.setMinWidth = function() {};
   Dialog.prototype.font = { width: function( s ) { return 7 * s.length; } };

   function processClass( kind ) {
      var C = function() {};
      C.prototype = { Image: 2, Parametric: 0, Gray: 1, SameAsTarget: 0, f32: 4 };
      C.prototype.executeOn = function( view ) {
         calls.push( kind + " on " + view.id + ( this.expression ? "  expr: " + this.expression : "" )
                     + ( this.expression1 ? " | " + this.expression1 + " | " + this.expression2 : "" )
                     + ( this.viewId ? "  kernel: " + this.viewId : "" )
                     + ( this.createNewImage ? "  -> " + this.newImageId : "" ) );
         if ( this.createNewImage ) fakeWindow( this.newImageId, false );
         return true;
      };
      return C;
   }

   var ImageWindow = function( w, h, n, bits, isFloat, isColor, id ) { return fakeWindow( id, isColor ); };
   ImageWindow.activeWindow = target;
   ImageWindow.windowById = function( id ) { return views[id] || { isNull: true }; };

   var store = opts.store || {};
   var env = {
      CoreApplication: { ensureMinimumVersion: function() {} },
      Console: { show: function() {}, flush: function() {},
                 writeln: function( s ) { consoleLines.push( String( s ) ); } },
      Settings: { lastReadOK: false,
                  read: function( k ) { this.lastReadOK = ( k in store ); return store[k]; },
                  write: function( k, t, v ) { store[k] = v; } },
      View: { viewById: function( id ) { return views[id] ? views[id].mainView : null; } },
      ImageWindow: ImageWindow, Dialog: Dialog, NumericControl: NumericControl,
      ComboBox: ComboBox, CheckBox: CheckBox, ViewList: ViewList,
      Label: looseClass(), PushButton: looseClass(), GroupBox: looseClass(),
      HorizontalSizer: looseClass(), VerticalSizer: looseClass(),
      PixelMath: processClass( "PixelMath" ), Convolution: processClass( "Convolution" ),
      TextAlign_Right: 1, TextAlign_VertCenter: 2, UndoFlag_NoSwapFile: 4,
      DataType_Double: 1, DataType_Boolean: 2, DataType_Int32: 3, DataType_String: 4
   };
   var names = Object.keys( env );
   var fn = Function.apply( null, names.concat( [ src ] ) );
   var threw = null;
   try { fn.apply( null, names.map( function( n ) { return env[n]; } ) ); }
   catch ( e ) { threw = e; }

   out( "== " + name + " ==" );
   consoleLines.forEach( function( l ) { out( "    | " + l ); } );
   calls.forEach( function( c ) { out( "    > " + c ); } );
   var errors = consoleLines.filter( function( l ) { return /^ERROR/.test( l ); } );
   var leftovers = Object.keys( views ).filter( function( id ) { return /^oc_/.test( id ); } );
   var ok = !threw && errors.length === 0 && leftovers.length === 0
            && calls.length >= opts.minCalls && opts.expect( consoleLines, calls, store );
   out( ( ok ? "  PASS  " : "  FAIL  " ) + name
        + ( threw ? "  threw: " + threw : "" )
        + ( leftovers.length ? "  temp windows left open: " + leftovers : "" ) );
   return ok ? 0 : 1;
}

var failures = 0;

failures += runCase( "mono, defaults, new image", {
   color: false, median: 0.01, minCalls: 4,
   expect: function( lines, calls ) {
      return calls[ calls.length - 1 ].indexOf( "-> target_oc" ) > 0
          && lines.some( function( l ) { return /Result\s+: target_oc/.test( l ); } );
   }
} );

failures += runCase( "RGB, RASA 8 from the list, plate-solved, in place, masked, stretched", {
   color: true, median: 0.4, solved: true, masked: true, minCalls: 8,
   tweak: function( d ) {
      var i = d.telescopeCombo.items.findIndex( function( t ) { return /RASA 8/.test( t ); } );
      d.telescopeCombo.currentItem = i;
      d.applyTelescope( i );
      d.inPlaceBox.checked = true;
      d.protectBox.checked = true;
   },
   expect: function( lines, calls, store ) {
      return lines.some( function( l ) { return /Telescope\s+: Celestron RASA 8/.test( l ); } )
          && lines.some( function( l ) { return /obstruction 45\.8 %/.test( l ); } )
          && lines.some( function( l ) { return /scale 1\.800/.test( l ); } )      // from the fake solution
          && lines.some( function( l ) { return /^WARNING: image median/.test( l ); } )
          && lines.some( function( l ) { return /bands R\/G\/B/.test( l ); } )
          && /PixelMath on target {2}expr: min\( 1, 3\*oc_starmask \)\*\$T\[0\]/.test( calls[ calls.length - 1 ] )
          && /RASA 8/.test( store[ "ObstructionCorrection/telescope" ] );
   }
} );

failures += runCase( "mono narrowband, no protection, FITS scale", {
   color: false, median: 0.02, minCalls: 3,
   keywords: [ { name: "FOCALLEN", value: "2032." }, { name: "XPIXSZ", value: "3.76" } ],
   tweak: function( d ) {
      d.bandCombo.currentItem = 5;             // H-alpha
      d.protectBox.checked = false;
      d.modeCombo.currentItem = 1;
   },
   expect: function( lines, calls ) {
      return lines.some( function( l ) { return /bands Ha {3}true equivalent/.test( l ); } )
          && lines.some( function( l ) { return /scale 0\.382/.test( l ); } )
          && !calls.some( function( c ) { return /starmask/.test( c ); } );
   }
} );

out( "" );
out( failures === 0 ? "SMOKE TEST PASSED (fake PixInsight — not proof of real behaviour)"
                    : failures + " SMOKE CASE(S) FAILED" );
exitWith( failures === 0 ? 0 : 1 );
