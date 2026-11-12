// ============================================================
// tools/selftest.js — verification of the portable math block.
//
// Run:  tools/test.sh          (picks Node if installed, else macOS jsc)
//
// Runs under BOTH Node.js and JavaScriptCore's `jsc` shell, from the
// repository root. It EXTRACTS the "portable ... math" block straight out
// of the shipped script (between its BEGIN/END markers) and evaluates it,
// so the math tested here is byte-for-byte the math PixInsight runs.
// It also parse-checks the whole script with the PJSR `#` directive lines
// removed (catches JS syntax errors only — not PixInsight API mistakes).
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
var failures = 0;

function check( name, got, want, eps ) {
   var ok = ( typeof want === "number" )
      ? Math.abs( got - want ) <= ( eps === undefined ? 1e-9 : eps )
      : ( got === want );
   out( ( ok ? "  PASS  " : "  FAIL  " ) + name + "   got=" + JSON.stringify( got )
        + ( ok ? "" : "  want=" + JSON.stringify( want ) ) );
   if ( !ok ) ++failures;
}

var src = readText( SCRIPT );

// ---- 1. syntax check of the whole script ---------------------------------
out( "== syntax check: " + SCRIPT + " ==" );
var stripped = src.split( "\n" ).map( function( l ) {
   return /^#/.test( l ) ? "" : l;          // keep line numbers aligned
} ).join( "\n" );
try {
   new Function( stripped );                 // parse only, never executed
   check( "script parses", true, true );
} catch ( e ) {
   check( "script parses (" + e + ")", false, true );
}
check( "'#engine v8' is the first line", src.indexOf( "#engine v8\n" ), 0 );
// PixInsight's preprocessor strips "//" to the end of the line even inside a
// regex literal (verified in 1.9.6: /^https?:\/\// became a syntax error).
check( "no regex literal contains an escaped slash followed by /",
       src.split( "\n" ).filter( function( l ) { return /\\\/\//.test( l ); } ).length, 0 );
check( "#feature-info is a single line",
       /^#feature-info[^\n]*\\\s*$/m.test( src ), false );

// ---- 2. extract + evaluate the portable block -----------------------------
var BEGIN = "BEGIN portable obstruction math", END = "END portable obstruction math";
var bi = src.indexOf( BEGIN ), ei = src.indexOf( END );
if ( bi < 0 || ei < 0 ) {
   out( "FATAL: math block markers not found in " + SCRIPT );
   exitWith( 2 );
}
var block = src.slice( src.indexOf( "\n", bi ) + 1, src.lastIndexOf( "\n", ei ) );
out( "== math block extracted (" + block.length + " chars) ==" );
var M = ( new Function( block +
   "\nreturn { lensArea: lensArea, mtfAnnular: mtfAnnular, mtfClear: mtfClear,"
   + " obstructionGain: obstructionGain, OPTICS: OPTICS,"
   + " opticsObstructionRatio: opticsObstructionRatio, opticsLabel: opticsLabel, opticsKey: opticsKey,"
   + " obstructedOptics: obstructedOptics, BANDS: BANDS, bandById: bandById,"
   + " imageScaleArcsec: imageScaleArcsec, cutoffCyclesPerPixel: cutoffCyclesPerPixel,"
   + " bandCutoffs: bandCutoffs, gainAt: gainAt, shapedGain: shapedGain,"
   + " MODE_RESTORE_ONLY: MODE_RESTORE_ONLY, MODE_TRUE_EQUIVALENT: MODE_TRUE_EQUIVALENT,"
   + " bandStats: bandStats, fft1d: fft1d, fft2d: fft2d, chooseKernelSize: chooseKernelSize,"
   + " buildKernel: buildKernel, kernelResponse: kernelResponse,"
   + " kernelNoiseGain: kernelNoiseGain, MODE_IDEAL_APERTURE: MODE_IDEAL_APERTURE,"
   + " DEFAULT_MAX_BOOST: DEFAULT_MAX_BOOST, wienerK: wienerK, idealGainAt: idealGainAt,"
   + " modeGainAt: modeGainAt };" ) )();

// ---- 3. tests --------------------------------------------------------------
out( "== lensArea ==" );
check( "disjoint circles", M.lensArea( 1, 1, 2.5 ), 0 );
check( "contained circle", M.lensArea( 1, 0.3, 0.2 ), Math.PI * 0.09, 1e-12 );
check( "identical circles", M.lensArea( 1, 1, 0 ), Math.PI, 1e-12 );

out( "== clear-aperture MTF vs closed form ==" );
function clearClosed( nu ) {
   return ( 2 / Math.PI ) * ( Math.acos( nu ) - nu * Math.sqrt( 1 - nu*nu ) );
}
[ 0.1, 0.3, 0.5, 0.9 ].forEach( function( nu ) {
   check( "mtfClear(" + nu + ")", M.mtfClear( nu ), clearClosed( nu ), 1e-12 );
} );
check( "mtfClear(0)", M.mtfClear( 0 ), 1 );
check( "mtfClear(1)", M.mtfClear( 1 ), 0 );

out( "== annular MTF vs O'Neill (1956) closed form ==" );
function oneill( nu, e ) {
   var A = ( 2 / Math.PI ) * ( Math.acos( nu ) - nu * Math.sqrt( 1 - nu*nu ) );
   var B = 0;
   if ( nu <= e ) {
      var x = nu / e;
      B = ( 2*e*e / Math.PI ) * ( Math.acos( x ) - x * Math.sqrt( 1 - x*x ) );
   }
   var C;
   if ( nu <= ( 1 - e ) / 2 ) C = -2*e*e;
   else if ( nu >= ( 1 + e ) / 2 ) C = 0;
   else {
      var phi = Math.acos( ( 1 + e*e - 4*nu*nu ) / ( 2*e ) );
      C = -2*e*e + ( 2*e / Math.PI ) * Math.sin( phi ) + ( ( 1 + e*e ) / Math.PI ) * phi
          - ( 2 * ( 1 - e*e ) / Math.PI ) * Math.atan( ( ( 1 + e ) / ( 1 - e ) ) * Math.tan( phi / 2 ) );
   }
   return ( A + B + C ) / ( 1 - e*e );
}
[ 0.2, 0.33, 0.46 ].forEach( function( e ) {
   var worst = 0;
   for ( var i = 1; i < 100; ++i )
      worst = Math.max( worst, Math.abs( oneill( i / 100, e ) - M.mtfAnnular( i / 100, e ) ) );
   check( "max |lens - O'Neill|, eps=" + e, worst, 0, 1e-12 );
} );

out( "== correction gain ==" );
check( "H(0, 0.35) = 1", M.obstructionGain( 0, 0.35 ), 1 );
check( "H(0.30, 0.35) ~ 1.42", M.obstructionGain( 0.30, 0.35 ), 1.415, 0.005 );
check( "H(0.30, 0.46) ~ 1.85", M.obstructionGain( 0.30, 0.46 ), 1.855, 0.01 );
check( "H = 1-eps^2 above (1+eps)/2", M.obstructionGain( 0.8, 0.35 ), 1 - 0.35*0.35, 1e-12 );
check( "H continuous at (1+eps)/2",
       M.mtfClear( 0.675 ) / M.mtfAnnular( 0.675, 0.35 ), 1 - 0.35*0.35, 1e-9 );
check( "H beyond cutoff stays finite", M.obstructionGain( 1.7, 0.35 ), 1 - 0.35*0.35, 1e-12 );
check( "no obstruction -> H = 1", M.obstructionGain( 0.4, 0 ), 1, 1e-12 );

out( "== optics catalogue helpers (fixture data, not the shipped table) ==" );
var fixture = [
   { maker: "Test", model: "Refractor 60", type: "Refractor", apertureMm: 60, focalMm: 360 },
   { maker: "Test", model: "Newton 200", type: "Newtonian", apertureMm: 200, focalMm: 800, obstructionMm: 70 },
   { maker: "Test", model: "Astrograph 130", type: "Astrograph", apertureMm: 130, focalMm: 430, obstructionPct: 48 },
   { maker: "Test", model: "Broken", type: "?", apertureMm: 0, obstructionMm: 10 }
];
check( "ratio from mm", M.opticsObstructionRatio( fixture[1] ), 0.35, 1e-12 );
check( "ratio from percent", M.opticsObstructionRatio( fixture[2] ), 0.48, 1e-12 );
check( "refractor has no obstruction", M.opticsObstructionRatio( fixture[0] ), 0 );
check( "unusable record -> 0", M.opticsObstructionRatio( fixture[3] ), 0 );
var listed = M.obstructedOptics( fixture );
check( "only obstructed optics are listed", listed.length, 2 );
check( "list is sorted by label", listed[0].model, "Astrograph 130" );
check( "label text", M.opticsLabel( fixture[1] ), "Test Newton 200 — 200 mm f/4.0, 35%" );
check( "settings key is maker + model", M.opticsKey( fixture[1] ), "Test Newton 200" );
check( "settings key without a maker", M.opticsKey( { model: " Solo 100 " } ), "Solo 100" );

out( "== shipped optics table ==" );
out( "  INFO  " + M.OPTICS.length + " record(s), "
     + M.obstructedOptics( M.OPTICS ).length + " with an obstruction" );
var bad = M.OPTICS.filter( function( o ) {
   return !o.model || !( o.apertureMm > 0 ) || ( o.obstructionMm > 0 && o.obstructionPct > 0 )
          || ( o.obstructionMm >= o.apertureMm ) || ( o.obstructionPct >= 100 );
} );
check( "every shipped record is well-formed", bad.length, 0 );
check( "21 obstructed optics (owner's sheet + manufacturer specs)", M.obstructedOptics( M.OPTICS ).length, 21 );
check( "full Sky-Watcher PDS, Quattro, Celestron RASA and Takahashi Epsilon lineups",
       [ "Explorer 130PDS", "Explorer 150PDS", "Explorer 200PDS", "Explorer 250PDS", "Explorer 300PDS",
         "Quattro 150P", "Quattro 200P", "Quattro 250P", "Quattro 300P", "RASA 8", "RASA 11", "RASA 36",
         "Epsilon-130D", "Epsilon-160ED", "Epsilon-180ED" ]
          .filter( function( m ) { return !M.OPTICS.some( function( o ) { return o.model.indexOf( m ) === 0; } ); } ).length, 0 );
check( "every record has one obstruction figure, in a sane range",
       M.OPTICS.filter( function( o ) { var e = M.opticsObstructionRatio( o ); return !( e > 0.15 && e < 0.6 ); } ).length, 0 );
M.obstructedOptics( M.OPTICS ).forEach( function( o ) { out( "        " + M.opticsLabel( o ) ); } );
var labels = M.OPTICS.map( M.opticsLabel );
check( "no duplicate labels", labels.filter( function( l, i ) { return labels.indexOf( l ) !== i; } ).length, 0 );
var keys = M.OPTICS.map( M.opticsKey );
check( "no duplicate settings keys", keys.filter( function( k, i ) { return keys.indexOf( k ) !== i; } ).length, 0 );
// PixInsight's Settings store strings as 8-bit (verified in 1.9.4: an em dash came back as U+0014).
check( "settings keys are plain ASCII", keys.filter( function( k ) { return /[^\x20-\x7E]/.test( k ); } ).length, 0 );

out( "== scale / cutoff ==" );
check( "scale 3.76um @ 406mm", M.imageScaleArcsec( 406, 3.76 ), 1.910, 0.002 );
check( "cutoff = pixel/(lambda*N): 3.76um, 550nm, f/5",
       M.cutoffCyclesPerPixel( 150, M.imageScaleArcsec( 750, 3.76 ), 550 ), 3.76 / ( 0.55 * 5 ), 1e-9 );
check( "band lookup", M.bandById( "Ha" ).nm[0], 656.3 );
check( "unknown band -> null", M.bandById( "nope" ), null );

out( "== polychromatic + shaped gain ==" );
check( "single wavelength = monochromatic", M.gainAt( 0.3, [ 1 ], 0.35 ), M.obstructionGain( 0.3, 0.35 ), 1e-12 );
check( "beyond all cutoffs -> 1-eps^2", M.gainAt( 0.49, [ 0.2, 0.25 ], 0.35 ), 1 - 0.35*0.35, 1e-12 );
var gp = M.gainAt( 0.3, [ 0.9, 1.0, 1.1 ], 0.35 );
check( "polychromatic lies between its extremes",
       gp > M.obstructionGain( 0.3/1.1, 0.35 ) && gp < M.obstructionGain( 0.3/0.9, 0.35 ), true );
check( "restore-only clamps to 1", M.shapedGain( 0.88, M.MODE_RESTORE_ONLY, 1 ), 1 );
check( "true mode keeps H<1", M.shapedGain( 0.88, M.MODE_TRUE_EQUIVALENT, 1 ), 0.88, 1e-12 );
check( "amount 0.5 halves the boost", M.shapedGain( 1.4, M.MODE_RESTORE_ONLY, 0.5 ), 1.2, 1e-12 );
check( "amount 0 -> identity", M.shapedGain( 1.4, M.MODE_TRUE_EQUIVALENT, 0 ), 1 );
var st = M.bandStats( [ 1 / ( 2 * 0.37 ) ], 0.35, M.MODE_TRUE_EQUIVALENT, 1 );
check( "noise gain, Nyquist at 0.37 of cutoff, eps .35 ~ 1.347", st.noise, 1.347, 0.01 );
check( "peak gain in that band ~ 1.51", st.peak, 1.508, 0.01 );

out( "== ideal-aperture gain (Wiener-limited diffraction inverse) ==" );
[ 1.5, 2, 3, 6 ].forEach( function( G ) {
   var k = M.wienerK( G );
   check( "wienerK(" + G + "): peak (1+k)/(2 sqrt k) = max boost", ( 1 + k ) / ( 2 * Math.sqrt( k ) ), G, 1e-12 );
} );
check( "wienerK(<=1) -> k = 1 (no boost anywhere)", M.wienerK( 0.5 ), 1, 1e-12 );
check( "ideal gain is 1 at f = 0", M.idealGainAt( 0, [ 1 ], 0.35, M.wienerK( 3 ) ), 1 );
check( "unlimited (k = 0) = 1 / MTF_obstructed", M.idealGainAt( 0.3, [ 1 ], 0.35, 0 ), 1 / M.mtfAnnular( 0.3, 0.35 ), 1e-12 );
check( "unlimited beyond the cutoff stays finite (1)", M.idealGainAt( 1.5, [ 1 ], 0.35, 0 ), 1 );
check( "limited beyond the cutoff falls to 0", M.idealGainAt( 1.5, [ 1 ], 0.35, M.wienerK( 3 ) ), 0, 1e-12 );
( function() {
   var k = M.wienerK( 3 ), worst = 0;
   for ( var i = 1; i < 400; ++i ) worst = Math.max( worst, M.idealGainAt( i / 400, [ 1 ], 0.46, k ) );
   check( "never above max boost, eps .46, whole band", worst <= 3 + 1e-12, true );
} )();
check( "ideal >= clear/obstructed ratio inside the band (it also undoes clear diffraction)",
       M.idealGainAt( 0.2, [ 1 ], 0.46, M.wienerK( 3 ) ) > M.gainAt( 0.2, [ 1 ], 0.46 ), true );
check( "refractor (eps 0): ideal gain = 1 / clear MTF", M.idealGainAt( 0.3, [ 1 ], 0, 0 ), 1 / M.mtfClear( 0.3 ), 1e-12 );
( function() {
   var c = M.bandCutoffs( M.bandById( "G" ), 80, M.imageScaleArcsec( 480, 3.76 ) );   // 80 mm f/6, 3.76 um
   var r = M.bandStats( c, 0, M.MODE_RESTORE_ONLY, 1 ), t = M.bandStats( c, 0, M.MODE_TRUE_EQUIVALENT, 1 );
   var i = M.bandStats( c, 0, M.MODE_IDEAL_APERTURE, 1, 3 );
   check( "refractor: restore-only does nothing", [ r.peak, r.noise ].join( "," ), "1,1" );
   check( "refractor: true equivalent does nothing", [ t.peak, t.noise ].join( "," ), "1,1" );
   out( "  INFO  80 mm f/6 refractor, 3.76 um (" + M.imageScaleArcsec( 480, 3.76 ).toFixed( 3 ) + "\"/px), G, ideal x3: peak x"
        + i.peak.toFixed( 3 ) + "  noise x" + i.noise.toFixed( 3 ) + "  (Nyquist at " + ( 50 / c[1] ).toFixed( 0 ) + " % of cutoff)" );
   check( "refractor: ideal aperture boosts", i.peak > 1.5 && i.noise > 1, true );
} )();
check( "polychromatic: inverse of the band-averaged MTF",
       M.idealGainAt( 0.3, [ 0.9, 1.1 ], 0.35, 0 ),
       2 / ( M.mtfAnnular( 0.3 / 0.9, 0.35 ) + M.mtfAnnular( 0.3 / 1.1, 0.35 ) ), 1e-12 );
check( "modeGainAt, ideal, amount 0.5 halves the boost",
       M.modeGainAt( 0.3, [ 1 ], 0.35, M.MODE_IDEAL_APERTURE, 0.5, 0 ), 1 + 0.5 * ( 1 / M.mtfAnnular( 0.3, 0.35 ) - 1 ), 1e-12 );
check( "modeGainAt, other modes = shapedGain( gainAt )",
       M.modeGainAt( 0.3, [ 1 ], 0.35, M.MODE_RESTORE_ONLY, 1, 0 ), M.shapedGain( M.gainAt( 0.3, [ 1 ], 0.35 ), M.MODE_RESTORE_ONLY, 1 ), 1e-12 );
( function() {
   // owner's RASA 8, 1.938"/px, green: restore-only vs ideal aperture (max boost 3)
   var c = M.bandCutoffs( M.bandById( "G" ), 203, 1.938 );
   var r = M.bandStats( c, 0.458, M.MODE_RESTORE_ONLY, 1 ), i = M.bandStats( c, 0.458, M.MODE_IDEAL_APERTURE, 1, 3 );
   out( "  INFO  RASA 8 @1.938\"/px, G: restore only peak x" + r.peak.toFixed( 3 ) + " noise x" + r.noise.toFixed( 3 )
        + "  |  ideal (max x3) peak x" + i.peak.toFixed( 3 ) + " noise x" + i.noise.toFixed( 3 ) );
   check( "ideal mode boosts more than restore-only", i.peak > r.peak && i.noise > r.noise, true );
   check( "bandStats default max boost = DEFAULT_MAX_BOOST",
          M.bandStats( c, 0.458, M.MODE_IDEAL_APERTURE, 1 ).peak, i.peak, 1e-12 );
} )();

out( "== FFT ==" );
( function() {
   var n = 16, re = new Float64Array( n ), im = new Float64Array( n ), keep = [];
   for ( var i = 0; i < n; ++i ) { re[i] = Math.sin( i*1.7 ) + 0.3*i; keep.push( re[i] ); }
   M.fft1d( re, im, false );
   var dc = 0; keep.forEach( function( v ) { dc += v; } );
   check( "fft1d DC term = sum", re[0], dc, 1e-9 );
   M.fft1d( re, im, true );
   var worst = 0;
   for ( i = 0; i < n; ++i ) worst = Math.max( worst, Math.abs( re[i] - keep[i] ), Math.abs( im[i] ) );
   check( "fft1d round trip", worst, 0, 1e-12 );
   var m = 8, r2 = new Float64Array( m*m ), i2 = new Float64Array( m*m );
   r2[0] = 1;                                   // delta -> flat spectrum
   M.fft2d( r2, i2, m, false );
   var flat = 0;
   for ( i = 0; i < m*m; ++i ) flat = Math.max( flat, Math.abs( r2[i] - 1 ), Math.abs( i2[i] ) );
   check( "fft2d of a delta is flat", flat, 0, 1e-12 );
} )();

out( "== correction kernel ==" );
check( "kernel size is odd and clamped (coarse)", M.chooseKernelSize( 3.4 ), 49 );
check( "kernel size clamped (fine)", M.chooseKernelSize( 0.05 ), 255 );
check( "ideal mode: same floor when undersampled", M.chooseKernelSize( 3.4, M.MODE_IDEAL_APERTURE ), 49 );
check( "ideal mode: twice the room when oversampled", M.chooseKernelSize( 0.572, M.MODE_IDEAL_APERTURE ), 2 * Math.ceil( 48 / 0.572 ) + 1 );
function kernelCase( name, cutoffs, eps, mode, maxBoost ) {
   var size = M.chooseKernelSize( Math.min.apply( null, cutoffs ), mode );
   var k = M.buildKernel( cutoffs, eps, mode, 1, size, maxBoost );
   var wk = M.wienerK( maxBoost === undefined ? M.DEFAULT_MAX_BOOST : maxBoost );
   var s = 0, asym = 0, c = ( size - 1 ) / 2;
   for ( var i = 0; i < k.data.length; ++i ) s += k.data[i];
   for ( var y = 0; y < size; ++y )
      for ( var x = 0; x < size; ++x )
         asym = Math.max( asym, Math.abs( k.data[y*size+x] - k.data[( size-1-y )*size + ( size-1-x )] ) );
   var worst = 0;
   for ( var j = 1; j <= 50; ++j ) {
      var f = j / 100;
      var want = M.modeGainAt( f, cutoffs, eps, mode, 1, wk );
      worst = Math.max( worst, Math.abs( M.kernelResponse( k, f ) - want ) / want );
   }
   out( "  INFO  " + name + ": size " + size + ", centre " + k.data[c*size+c].toFixed( 4 )
        + ", worst relative response error " + worst.toFixed( 5 )
        + ", noise gain " + M.kernelNoiseGain( k ).toFixed( 4 ) );
   check( name + ": sum = 1", s, 1, 1e-12 );
   check( name + ": point-symmetric", asym, 0, 1e-12 );
   check( name + ": response within 1 % of the target gain", worst < 0.01, true );
   return k;
}
var kq = kernelCase( "f/5 Newtonian 35%, true mode", [ 1 / ( 2 * 0.37 ) ], 0.35, M.MODE_TRUE_EQUIVALENT );
check( "kernel noise gain matches the band figure", M.kernelNoiseGain( kq ), st.noise, 0.01 );
kernelCase( "RASA 8 46%, restore only, L band",
            M.bandCutoffs( M.bandById( "L" ), 203, M.imageScaleArcsec( 406, 3.76 ) ), 0.458, M.MODE_RESTORE_ONLY );
kernelCase( "EdgeHD 8 34%, restore only, Ha",
            M.bandCutoffs( M.bandById( "Ha" ), 203, M.imageScaleArcsec( 2032, 3.76 ) ), 0.339, M.MODE_RESTORE_ONLY );
kernelCase( "oversampled planetary 34%, true mode", [ 0.26 ], 0.34, M.MODE_TRUE_EQUIVALENT );
kernelCase( "RASA 8 46%, ideal aperture x3, G band",
            M.bandCutoffs( M.bandById( "G" ), 203, 1.938 ), 0.458, M.MODE_IDEAL_APERTURE, 3 );
kernelCase( "80 mm f/6 refractor, ideal aperture x3, G band",
            M.bandCutoffs( M.bandById( "G" ), 80, M.imageScaleArcsec( 480, 3.76 ) ), 0, M.MODE_IDEAL_APERTURE, 3 );
kernelCase( "EdgeHD 8 34%, ideal aperture x6, Ha",
            M.bandCutoffs( M.bandById( "Ha" ), 203, M.imageScaleArcsec( 2032, 3.76 ) ), 0.339, M.MODE_IDEAL_APERTURE, 6 );

out( "" );
out( failures === 0 ? "ALL TESTS PASSED" : ( failures + " TEST(S) FAILED" ) );
exitWith( failures === 0 ? 0 : 1 );
