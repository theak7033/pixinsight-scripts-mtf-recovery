// ============================================================
// tools/plot-mtf.js — draws the README figure
//     docs/images/mtf-obstruction.svg        (light)
//     docs/images/mtf-obstruction-dark.svg   (dark)
//
// Run from the repository root:   node tools/plot-mtf.js
//
// The curves come from the SHIPPED math: the "portable obstruction math"
// block is extracted from the script exactly as tools/selftest.js does, so
// the figure cannot drift from what PixInsight runs. No dependencies.
// ============================================================
var fs = require( "fs" ), path = require( "path" );
var ROOT = path.join( __dirname, ".." );
var src = fs.readFileSync( path.join( ROOT, "src/scripts/ObstructionCorrection/ObstructionCorrection.js" ), "utf8" );
var bi = src.indexOf( "BEGIN portable obstruction math" ), ei = src.indexOf( "END portable obstruction math" );
var M = ( new Function( src.slice( src.indexOf( "\n", bi ) + 1, src.lastIndexOf( "\n", ei ) )
   + "\nreturn { mtfClear: mtfClear, mtfAnnular: mtfAnnular, cutoffCyclesPerPixel: cutoffCyclesPerPixel };" ) )();

// ---- the example: Celestron RASA 8 at the owner's image scale --------------
var EPS = 0.458, APERTURE_MM = 203, SCALE = 1.938, LAMBDA_NM = 530;
var cutoff = M.cutoffCyclesPerPixel( APERTURE_MM, SCALE, LAMBDA_NM );     // cycles/px
var NU_PIXEL = Math.SQRT1_2 / cutoff;        // finest scale the pixel grid holds (diagonal Nyquist)
function gain( nu ) { return Math.max( 1, M.mtfClear( nu ) / M.mtfAnnular( nu, EPS ) ); }
var peakNu = 0, peak = 1;
for ( var i = 1; i < 1000; ++i ) if ( gain( i / 1000 ) > peak ) { peak = gain( i / 1000 ); peakNu = i / 1000; }

// ---- themes: categorical slots 1-3 of the reference palette, both modes
// validated (CVD, contrast) on their surface --------------------------------
var THEMES = {
   light: { file: "mtf-obstruction.svg", surface: "#fcfcfb", text: "#0b0b0b", text2: "#52514e", muted: "#898781",
            grid: "#e1e0d9", axis: "#c3c2b7", ring: "rgba(11,11,11,0.10)", band: "rgba(11,11,11,0.07)",
            clear: "#2a78d6", obstructed: "#eb6834", gain: "#1baf7a" },
   dark:  { file: "mtf-obstruction-dark.svg", surface: "#1a1a19", text: "#f0efec", text2: "#c3c2b7", muted: "#898781",
            grid: "#2c2c2a", axis: "#383835", ring: "rgba(255,255,255,0.10)", band: "rgba(255,255,255,0.08)",
            clear: "#3987e5", obstructed: "#d95926", gain: "#199e70" }
};

var W = 1000, H = 466, TOP = 132, BOTTOM = 388;
var A = { x0: 70, x1: 480 }, B = { x0: 580, x1: 960 };
function esc( s ) { return String( s ).replace( /&/g, "&amp;" ).replace( /</g, "&lt;" ).replace( />/g, "&gt;" ); }
function f1( v ) { return v.toFixed( 1 ); }

function draw( T ) {
   var o = [];
   function text( x, y, s, size, fill, extra ) {
      o.push( '<text x="' + f1( x ) + '" y="' + f1( y ) + '" font-size="' + size + '" fill="' + fill + '"' + ( extra || "" ) + '>' + esc( s ) + '</text>' );
   }
   function panel( P, yMin, yMax, yTicks, yFormat ) {
      P.sx = function( nu ) { return P.x0 + nu * ( P.x1 - P.x0 ); };
      P.sy = function( v ) { return BOTTOM - ( v - yMin ) / ( yMax - yMin ) * ( BOTTOM - TOP ); };
      // the scales this image records
      o.push( '<rect x="' + f1( P.x0 ) + '" y="' + TOP + '" width="' + f1( P.sx( NU_PIXEL ) - P.x0 ) + '" height="' + ( BOTTOM - TOP ) + '" fill="' + T.band + '"/>' );
      yTicks.forEach( function( v ) {
         var y = P.sy( v );
         if ( v !== yMin )
            o.push( '<line x1="' + P.x0 + '" y1="' + f1( y ) + '" x2="' + P.x1 + '" y2="' + f1( y ) + '" stroke="' + T.grid + '" stroke-width="1"/>' );
         text( P.x0 - 8, y + 4, yFormat( v ), 11, T.muted, ' text-anchor="end"' );
      } );
      o.push( '<line x1="' + P.x0 + '" y1="' + BOTTOM + '" x2="' + P.x1 + '" y2="' + BOTTOM + '" stroke="' + T.axis + '" stroke-width="1"/>' );
      [ 0, 0.2, 0.4, 0.6, 0.8, 1 ].forEach( function( nu ) {
         text( P.sx( nu ), BOTTOM + 17, nu === 0 ? "0" : nu === 1 ? "1 (cutoff)" : nu.toFixed( 1 ), 11, T.muted, ' text-anchor="middle"' );
      } );
      text( ( P.x0 + P.x1 ) / 2, BOTTOM + 38, "Spatial frequency, as a fraction of the diffraction cutoff  (finer detail →)", 12, T.text2, ' text-anchor="middle"' );
   }
   function curve( P, fn, color ) {
      var d = "";
      for ( var i = 0; i <= 400; ++i ) {
         var nu = i / 400;
         d += ( i ? "L" : "M" ) + f1( P.sx( nu ) ) + " " + f1( P.sy( fn( nu ) ) );
      }
      o.push( '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' );
   }
   function dot( P, nu, v, color ) {
      o.push( '<circle cx="' + f1( P.sx( nu ) ) + '" cy="' + f1( P.sy( v ) ) + '" r="4.5" fill="' + color + '" stroke="' + T.surface + '" stroke-width="2"/>' );
   }
   function key( x, y, color, label ) {
      o.push( '<line x1="' + x + '" y1="' + ( y - 4 ) + '" x2="' + ( x + 20 ) + '" y2="' + ( y - 4 ) + '" stroke="' + color + '" stroke-width="2" stroke-linecap="round"/>' );
      text( x + 26, y, label, 12, T.text2 );
   }

   o.push( '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H
           + '" font-family="\'Segoe UI\', system-ui, -apple-system, Helvetica, Arial, sans-serif" role="img"'
           + ' aria-label="Contrast transfer (MTF) of a telescope with and without a 46 percent central obstruction, and the correction ObstructionCorrection applies">' );
   o.push( '<rect x="0.5" y="0.5" width="' + ( W - 1 ) + '" height="' + ( H - 1 ) + '" rx="8" fill="' + T.surface + '" stroke="' + T.ring + '"/>' );
   text( 24, 34, "What a 46% central obstruction does to contrast (Celestron RASA 8)", 17, T.text, ' font-weight="600"' );

   // ---- panel A: the two MTFs ------------------------------------------------
   text( A.x0, 66, "Contrast that gets through (MTF)", 14, T.text, ' font-weight="600"' );
   text( A.x0, 84, "Lower with the obstruction, but never zero below the cutoff", 12, T.text2 );
   key( A.x0, 110, T.clear, "No obstruction (refractor)" );
   key( A.x0 + 200, 110, T.obstructed, "46% obstruction" );
   panel( A, 0, 1, [ 0, 0.25, 0.5, 0.75, 1 ], function( v ) { return Math.round( 100 * v ) + "%"; } );
   curve( A, M.mtfClear, T.clear );
   curve( A, function( nu ) { return M.mtfAnnular( nu, EPS ); }, T.obstructed );
   text( A.sx( NU_PIXEL ) + 8, A.sy( 0.93 ), "← recorded at " + SCALE.toFixed( 2 ) + "″/px", 12, T.text2 );
   text( A.sx( 0.30 ), A.sy( 0.70 ), "no obstruction", 12, T.text2 );
   text( A.sx( 0.40 ), A.sy( 0.13 ), "46% obstruction", 12, T.text2 );

   // ---- panel B: the correction ------------------------------------------------
   text( B.x0, 66, "What the script multiplies by", 14, T.text, ' font-weight="600"' );
   text( B.x0, 84, "No obstruction ÷ 46% obstruction, never less than ×1", 12, T.text2 );
   panel( B, 1, 2, [ 1, 1.25, 1.5, 1.75, 2 ], function( v ) { return "×" + v.toFixed( 2 ); } );
   curve( B, gain, T.gain );
   dot( B, NU_PIXEL, gain( NU_PIXEL ), T.gain );
   // left of the marker, above the rising curve: the only place this label never meets the line
   text( B.sx( NU_PIXEL ) - 10, B.sy( gain( NU_PIXEL ) ) - 20, "×" + gain( NU_PIXEL ).toFixed( 2 ), 12, T.text2, ' text-anchor="end"' );
   text( B.sx( NU_PIXEL ) - 10, B.sy( gain( NU_PIXEL ) ) - 5, "pixel limit", 12, T.text2, ' text-anchor="end"' );
   dot( B, peakNu, peak, T.gain );
   text( B.sx( peakNu ) + 12, B.sy( peak ) - 6, "×" + peak.toFixed( 2 ) + " at most", 12, T.text2 );

   text( 24, H - 14, "Diffraction MTF of a clear and an annular aperture, one wavelength (" + LAMBDA_NM + " nm). Shaded: the scales a RASA 8 records at "
         + SCALE.toFixed( 2 ) + "″/px.", 11, T.muted );
   o.push( '</svg>' );
   return o.join( "\n" ) + "\n";
}

var outDir = path.join( ROOT, "docs/images" );
Object.keys( THEMES ).forEach( function( name ) {
   fs.writeFileSync( path.join( outDir, THEMES[name].file ), draw( THEMES[name] ) );
   console.log( "wrote docs/images/" + THEMES[name].file );
} );
console.log( "cutoff " + cutoff.toFixed( 3 ) + " cycles/px; pixel limit at " + NU_PIXEL.toFixed( 3 ) + " of cutoff, gain x" + gain( NU_PIXEL ).toFixed( 3 )
             + "; peak gain x" + peak.toFixed( 3 ) + " at " + peakNu.toFixed( 2 ) );
