#engine v8
// ============================================================
// ObstructionCorrection.js — PixInsight Script  v0.2.0
//
// Restores the contrast a telescope's central obstruction removes at
// medium spatial frequencies, by filtering a LINEAR image with
//     H(f) = MTF_clear(f) / MTF_obstructed(f, eps)
// The filter needs no PSF measurement: it follows from the aperture, the
// obstruction, the image scale and the wavelength band. It is applied as
// a small convolution kernel through PixInsight's own Convolution process.
// Use on LINEAR data. See PLAN.md / README.md for the design and limits.
//
// REQUIREMENTS
//   • PixInsight 1.9.4+ (V8 engine; #engine v8 above).
// ============================================================

#feature-id    ObstructionCorrection : Utilities > ObstructionCorrection
#feature-info  Restores contrast lost to a telescope's central obstruction on linear images (clear-aperture / obstructed-aperture MTF ratio). Requires PixInsight 1.9.4+ (V8 engine).

#include <pjsr/TextAlign.jsh>
#include <pjsr/UndoFlag.jsh>
#include <pjsr/DataType.jsh>

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

// ============================================================
// ===== BEGIN portable obstruction math (tested by tools/selftest.js) =====
// Pure functions only — NO PixInsight globals. tools/selftest.js extracts
// this exact block and verifies it under Node.js or macOS jsc.
// ============================================================

// Intersection area of two circles of radii a and b whose centres are s apart.
function lensArea( a, b, s ) {
   if ( s >= a + b ) return 0;
   if ( s <= Math.abs( a - b ) ) {
      let m = Math.min( a, b );
      return Math.PI * m * m;
   }
   let t1 = a*a * Math.acos( ( s*s + a*a - b*b ) / ( 2*s*a ) );
   let t2 = b*b * Math.acos( ( s*s + b*b - a*a ) / ( 2*s*b ) );
   let t3 = 0.5 * Math.sqrt( Math.max( 0, ( -s+a+b )*( s+a-b )*( s-a+b )*( s+a+b ) ) );
   return t1 + t2 - t3;
}

// Diffraction MTF of an annular aperture.
//   nu  : spatial frequency as a fraction of the cutoff (0..1)
//   eps : linear obstruction ratio d/D (0 = clear aperture)
function mtfAnnular( nu, eps ) {
   if ( nu <= 0 ) return 1;
   if ( nu >= 1 ) return 0;
   let s = 2 * nu;                       // pupil shift for outer radius 1
   let overlap = lensArea( 1, 1, s );
   if ( eps > 0 )
      overlap += lensArea( eps, eps, s ) - 2 * lensArea( 1, eps, s );
   return overlap / ( Math.PI * ( 1 - eps*eps ) );
}

function mtfClear( nu ) {
   return mtfAnnular( nu, 0 );
}

// Monochromatic correction gain H = MTF_clear / MTF_obstructed.
// Equals exactly 1 - eps^2 for nu >= (1+eps)/2, and that constant is
// kept beyond the cutoff, where both MTFs are zero.
function obstructionGain( nu, eps ) {
   if ( nu <= 0 ) return 1;
   if ( nu >= ( 1 + eps ) / 2 ) return 1 - eps*eps;
   return mtfClear( nu ) / mtfAnnular( nu, eps );
}

// ------------------------------------------------------------
// Optics catalogue — feeds the "Telescope" drop-down in the dialog.
//
// One record per optic:
//   { maker, model, type, apertureMm, focalMm, obstructionMm | obstructionPct }
//     type            free text shown in the list ("Newtonian", "SCT", "RASA", ...)
//     obstructionMm   secondary / baffle diameter in mm, OR
//     obstructionPct  linear obstruction as % of aperture diameter
//   Refractors and other unobstructed optics may stay in the table; only
//   records with an obstruction reach the drop-down (see obstructedOptics).
//
// SOURCE: the owner's optics spreadsheet (filter band-shift study), rows
// whose corrected f-ratio Fc exceeds the nominal F. Derived per row as
//   obstruction = sqrt( 1 - (F/Fc)^2 ),  aperture = effective aperture /
//   sqrt( 1 - obstruction^2 ) (rounded to the nominal mm),  focal = aperture * F.
// F and Fc carry two decimals, so obstructionPct is good to about +-0.5.
// Do not add entries from memory — a wrong obstruction figure silently
// gives a wrong filter. Unobstructed rows of the sheet are left out.
// ------------------------------------------------------------
var OPTICS = [
   { maker: "Celestron",    model: "RASA 8",                 type: "RASA",                apertureMm: 203, focalMm:  406, obstructionPct: 45.8 },
   { maker: "Celestron",    model: "C6 + Hyperstar (RASA 6)", type: "SCT + Hyperstar",    apertureMm: 152, focalMm:  300, obstructionPct: 50.3 },
   { maker: "Celestron",    model: "RASA 11",                type: "RASA",                apertureMm: 279, focalMm:  620, obstructionPct: 40.7 },
   { maker: "Sharpstar",    model: "HNT 150",                type: "Hyperbolic Newtonian", apertureMm: 150, focalMm:  420, obstructionPct: 46.9 },
   { maker: "Sharpstar",    model: "HNT 130",                type: "Hyperbolic Newtonian", apertureMm: 130, focalMm:  364, obstructionPct: 49.9 },
   { maker: "Askar",        model: "N160",                   type: "Newtonian astrograph", apertureMm: 160, focalMm:  544, obstructionPct: 43.7 },
   { maker: "Takahashi",    model: "Epsilon 130",            type: "Hyperbolic astrograph", apertureMm: 130, focalMm:  430, obstructionPct: 50.4 },
   { maker: "Sky-Watcher",  model: "Quattro 250P (10\")",    type: "Newtonian",           apertureMm: 250, focalMm: 1000, obstructionPct: 30.5 },
   { maker: "Sky-Watcher",  model: "Quattro 150P",           type: "Newtonian",           apertureMm: 150, focalMm:  600, obstructionPct: 34.4 },
   { maker: "Sky-Watcher",  model: "130/650 PDS",            type: "Newtonian",           apertureMm: 130, focalMm:  650, obstructionPct: 36.0 },
   { maker: "TS-Optics",    model: "GSO 8\" RC",             type: "Ritchey-Chretien",    apertureMm: 203, focalMm: 1624, obstructionPct: 41.9 },
   { maker: "Celestron",    model: "EdgeHD 8\"",             type: "SCT",                 apertureMm: 203, focalMm: 2032, obstructionPct: 33.9 }
];

// Linear obstruction ratio d/D of a catalogue record (0 when it has none
// or the record is unusable).
function opticsObstructionRatio( o ) {
   if ( !o || !( o.apertureMm > 0 ) ) return 0;
   let eps = 0;
   if ( o.obstructionMm > 0 ) eps = o.obstructionMm / o.apertureMm;
   else if ( o.obstructionPct > 0 ) eps = o.obstructionPct / 100;
   return ( eps > 0 && eps < 1 ) ? eps : 0;
}

// Text of one drop-down row, e.g. "Celestron RASA 8 — 203 mm f/2.0, 46%".
function opticsLabel( o ) {
   let s = ( ( o.maker ? o.maker + " " : "" ) + o.model ).trim();
   s += " — " + Math.round( o.apertureMm ) + " mm";
   if ( o.focalMm > 0 )
      s += " f/" + ( o.focalMm / o.apertureMm ).toFixed( 1 );
   s += ", " + Math.round( 100 * opticsObstructionRatio( o ) ) + "%";
   return s;
}

// Key a telescope is remembered by in Settings, e.g. "Celestron RASA 8".
// Plain ASCII on purpose: PixInsight's Settings store strings as 8-bit, so
// the label's em dash comes back as U+0014 and would never match again.
function opticsKey( o ) {
   return ( ( o.maker ? o.maker + " " : "" ) + o.model ).trim();
}

// The records that have a central obstruction, sorted by label.
function obstructedOptics( list ) {
   return list
      .filter( function( o ) { return opticsObstructionRatio( o ) > 0; } )
      .sort( function( a, b ) {
         let la = opticsLabel( a ).toLowerCase(), lb = opticsLabel( b ).toLowerCase();
         return la < lb ? -1 : ( la > lb ? 1 : 0 );
      } );
}

// ------------------------------------------------------------
// Wavelength bands. Each band is a short list of wavelengths (nm) that
// are averaged with equal weight — a coarse stand-in for the filter
// passband, good enough because H changes slowly with wavelength.
// ------------------------------------------------------------
var BANDS = [
   { id: "L",    label: "Luminance / broadband", nm: [ 450, 500, 550, 600, 650 ] },
   { id: "R",    label: "Red",                   nm: [ 600, 630, 660 ] },
   { id: "G",    label: "Green",                 nm: [ 500, 530, 560 ] },
   { id: "B",    label: "Blue",                  nm: [ 430, 460, 490 ] },
   { id: "Ha",   label: "H-alpha 656 nm",        nm: [ 656.3 ] },
   { id: "OIII", label: "OIII 501 nm",           nm: [ 500.7 ] },
   { id: "SII",  label: "SII 672 nm",            nm: [ 672.4 ] }
];

function bandById( id ) {
   for ( let i = 0; i < BANDS.length; ++i )
      if ( BANDS[i].id === id ) return BANDS[i];
   return null;
}

var ARCSEC_PER_RAD = 206264.80624709636;

// Image scale (arcsec/px) from focal length (mm) and pixel size (um).
function imageScaleArcsec( focalMm, pixelUm ) {
   return ARCSEC_PER_RAD * ( pixelUm * 1e-3 ) / focalMm;
}

// Diffraction cutoff in cycles per pixel:  D / lambda  *  scale[rad/px].
function cutoffCyclesPerPixel( apertureMm, scaleArcsec, lambdaNm ) {
   return ( apertureMm * 1e-3 ) / ( lambdaNm * 1e-9 ) * ( scaleArcsec / ARCSEC_PER_RAD );
}

// Cutoffs (cycles/px) for every wavelength of a band.
function bandCutoffs( band, apertureMm, scaleArcsec ) {
   return band.nm.map( function( nm ) {
      return cutoffCyclesPerPixel( apertureMm, scaleArcsec, nm );
   } );
}

// Polychromatic gain at pixel frequency f (cycles/px): ratio of the
// band-averaged clear and obstructed MTFs.
function gainAt( f, cutoffs, eps ) {
   if ( f <= 0 || eps <= 0 ) return 1;
   let sc = 0, sa = 0;
   for ( let i = 0; i < cutoffs.length; ++i ) {
      let nu = f / cutoffs[i];
      sc += mtfClear( nu );
      sa += mtfAnnular( nu, eps );
   }
   if ( sa < 1e-12 ) return 1 - eps*eps;      // beyond every cutoff
   return sc / sa;
}

// Gain shaping. mode 0 = "restore only" (never below 1), 1 = true
// unobstructed-aperture equivalent. amount 0..1 scales the correction.
var MODE_RESTORE_ONLY = 0;
var MODE_TRUE_EQUIVALENT = 1;
function shapedGain( H, mode, amount ) {
   if ( mode === MODE_RESTORE_ONLY && H < 1 ) H = 1;
   return 1 + amount * ( H - 1 );
}

// mode 2 = "ideal aperture": also undo the diffraction of the clear
// aperture, i.e. invert the obstructed MTF M itself, not just the ratio.
// A plain 1/M explodes where M -> 0, so it is Wiener-limited:
//     H = M (1 + k) / (M^2 + k)
// H(0) = 1, H -> 1/M for k -> 0, and H never exceeds (1 + k) / (2 sqrt k),
// reached at M = sqrt k. Beyond the cutoff (M = 0) H falls to 0.
var MODE_IDEAL_APERTURE = 2;
var DEFAULT_MAX_BOOST = 3.0;

// Wiener constant k whose largest possible gain is exactly maxBoost.
// (1 + s^2) / (2 s) = G  ->  s = G - sqrt( G^2 - 1 ),  k = s^2.
function wienerK( maxBoost ) {
   let G = ( maxBoost > 1 ) ? maxBoost : 1;
   let s = G - Math.sqrt( G*G - 1 );
   return s * s;
}

// Polychromatic ideal-aperture gain at pixel frequency f: Wiener inverse of
// the band-averaged obstructed MTF.
function idealGainAt( f, cutoffs, eps, k ) {
   if ( f <= 0 ) return 1;
   let m = 0;
   for ( let i = 0; i < cutoffs.length; ++i )
      m += mtfAnnular( f / cutoffs[i], eps );
   m /= cutoffs.length;
   if ( !( k > 0 ) ) return m > 1e-12 ? 1 / m : 1;   // unlimited: only for tests
   return m * ( 1 + k ) / ( m*m + k );
}

// Final gain at frequency f for any mode; k = wienerK( maxBoost ).
function modeGainAt( f, cutoffs, eps, mode, amount, k ) {
   if ( mode === MODE_IDEAL_APERTURE )
      return 1 + amount * ( idealGainAt( f, cutoffs, eps, k ) - 1 );
   return shapedGain( gainAt( f, cutoffs, eps ), mode, amount );
}

// Peak gain inside the sampled band and the white-noise sigma gain
// (root mean square of the gain over the whole frequency square).
// maxBoost is used by the ideal-aperture mode only.
function bandStats( cutoffs, eps, mode, amount, maxBoost ) {
   let n = 96, peak = 1, acc = 0;
   let k = wienerK( maxBoost === undefined ? DEFAULT_MAX_BOOST : maxBoost );
   for ( let iy = 0; iy < n; ++iy ) {
      let fy = ( iy + 0.5 ) / n * 0.5;
      for ( let ix = 0; ix < n; ++ix ) {
         let fx = ( ix + 0.5 ) / n * 0.5;
         let h = modeGainAt( Math.sqrt( fx*fx + fy*fy ), cutoffs, eps, mode, amount, k );
         if ( h > peak ) peak = h;
         acc += h*h;
      }
   }
   return { peak: peak, noise: Math.sqrt( acc / ( n*n ) ) };
}

// In-place radix-2 complex FFT of length n (power of two).
function fft1d( re, im, inverse ) {
   let n = re.length;
   for ( let i = 1, j = 0; i < n; ++i ) {
      let bit = n >> 1;
      for ( ; j & bit; bit >>= 1 ) j ^= bit;
      j ^= bit;
      if ( i < j ) {
         let t = re[i]; re[i] = re[j]; re[j] = t;
         t = im[i]; im[i] = im[j]; im[j] = t;
      }
   }
   for ( let len = 2; len <= n; len <<= 1 ) {
      let ang = 2 * Math.PI / len * ( inverse ? 1 : -1 );
      let wr = Math.cos( ang ), wi = Math.sin( ang );
      for ( let i = 0; i < n; i += len ) {
         let cr = 1, ci = 0;
         for ( let k = 0, half = len >> 1; k < half; ++k ) {
            let a = i + k, b = a + half;
            let xr = re[b]*cr - im[b]*ci, xi = re[b]*ci + im[b]*cr;
            re[b] = re[a] - xr; im[b] = im[a] - xi;
            re[a] += xr;        im[a] += xi;
            let t = cr*wr - ci*wi; ci = cr*wi + ci*wr; cr = t;
         }
      }
   }
   if ( inverse )
      for ( let i = 0; i < n; ++i ) { re[i] /= n; im[i] /= n; }
}

// In-place 2-D FFT of an n x n complex array stored row-major.
function fft2d( re, im, n, inverse ) {
   let tr = new Float64Array( n ), ti = new Float64Array( n );
   for ( let y = 0; y < n; ++y ) {
      let o = y * n;
      for ( let x = 0; x < n; ++x ) { tr[x] = re[o+x]; ti[x] = im[o+x]; }
      fft1d( tr, ti, inverse );
      for ( let x = 0; x < n; ++x ) { re[o+x] = tr[x]; im[o+x] = ti[x]; }
   }
   for ( let x = 0; x < n; ++x ) {
      for ( let y = 0; y < n; ++y ) { tr[y] = re[y*n+x]; ti[y] = im[y*n+x]; }
      fft1d( tr, ti, inverse );
      for ( let y = 0; y < n; ++y ) { re[y*n+x] = tr[y]; im[y*n+x] = ti[y]; }
   }
}

// Odd kernel size for a given (smallest) cutoff in cycles/px: the kernel
// structure is about 1/cutoff pixels wide, the 1/r^3 tail needs room.
// The ideal-aperture gain peaks and falls steeply near the cutoff, so on
// oversampled data it needs twice the room to stay within 1 %.
function chooseKernelSize( minCutoff, mode ) {
   let room = ( mode === MODE_IDEAL_APERTURE ) ? 48 : 24;
   let half = Math.ceil( room / Math.max( minCutoff, 0.02 ) );
   half = Math.min( 127, Math.max( 24, half ) );
   return 2 * half + 1;
}

// Correction kernel: inverse FFT of the shaped gain sampled on a 512 x 512
// frequency grid, cropped to size x size (odd), edge-tapered, sum = 1.
// Returns { size, data } with data row-major, centre at (size-1)/2.
function buildKernel( cutoffs, eps, mode, amount, size, maxBoost ) {
   let n = 512, half = ( size - 1 ) >> 1;
   let re = new Float64Array( n*n ), im = new Float64Array( n*n );
   let k = wienerK( maxBoost === undefined ? DEFAULT_MAX_BOOST : maxBoost );
   for ( let y = 0; y < n; ++y ) {
      let fy = ( y < n/2 ? y : y - n ) / n;
      for ( let x = 0; x < n; ++x ) {
         let fx = ( x < n/2 ? x : x - n ) / n;
         re[y*n+x] = modeGainAt( Math.sqrt( fx*fx + fy*fy ), cutoffs, eps, mode, amount, k );
      }
   }
   fft2d( re, im, n, true );
   let data = new Float64Array( size*size ), sum = 0;
   let r0 = 0.7 * half, r1 = half + 0.5;
   for ( let y = -half; y <= half; ++y )
      for ( let x = -half; x <= half; ++x ) {
         let r = Math.sqrt( x*x + y*y ), w = 1;
         if ( r >= r1 ) w = 0;
         else if ( r > r0 ) w = 0.5 * ( 1 + Math.cos( Math.PI * ( r - r0 ) / ( r1 - r0 ) ) );
         let v = w * re[ ( ( y + n ) % n ) * n + ( ( x + n ) % n ) ];
         data[ ( y + half ) * size + ( x + half ) ] = v;
         sum += v;
      }
   for ( let i = 0; i < data.length; ++i ) data[i] /= sum;
   return { size: size, data: data };
}

// Frequency response of a kernel at (fx, 0) cycles/px — for verification.
function kernelResponse( kernel, fx ) {
   let half = ( kernel.size - 1 ) >> 1, acc = 0;
   for ( let y = 0; y < kernel.size; ++y )
      for ( let x = 0; x < kernel.size; ++x )
         acc += kernel.data[ y*kernel.size + x ] * Math.cos( 2 * Math.PI * fx * ( x - half ) );
   return acc;
}

// White-noise sigma gain of a kernel.
function kernelNoiseGain( kernel ) {
   let acc = 0;
   for ( let i = 0; i < kernel.data.length; ++i ) acc += kernel.data[i] * kernel.data[i];
   return Math.sqrt( acc );
}

// ============================================================
// ===== END portable obstruction math =====
// ============================================================


// ============================================================
//  CONFIGURATION — internals; user-facing parameters live in the dialog
// ============================================================
const VERSION = "0.2.0";
const SETTINGS_KEY = "ObstructionCorrection/";

const DEFAULT_APERTURE_MM     = 200;
const DEFAULT_OBSTRUCTION_PCT = 35;
const DEFAULT_FOCAL_MM        = 800;
const DEFAULT_PIXEL_UM        = 3.76;
const DEFAULT_AMOUNT          = 1.0;
const DEFAULT_SAT_THRESHOLD   = 0.95;   // pixels at/above this count as saturated
const STAR_MASK_SIGMA         = 4.0;    // px, growth of the saturated-star protection
const STAR_MASK_GAIN          = 3;      // blurred mask is multiplied by this, then clipped to 1
const NONLINEAR_MEDIAN        = 0.20;   // a median above this suggests a stretched image

// ============================================================
//  Logging + small helpers
// ============================================================
function log( msg ) {
   Console.writeln( msg );
   Console.flush();
}

function errText( e ) {
   // PJSR native errors are often plain strings, not Error objects.
   return ( e && e.message ) ? e.message : String( e );
}

function trySet( obj, name, value ) {
   try { obj[ name ] = value; } catch ( e ) { /* property not on this build */ }
}

// View.viewById returns plain null for a missing view (no .isNull).
function uniqueViewId( baseId ) {
   let id = baseId;
   for ( let i = 1; View.viewById( id ); ++i )
      id = baseId + i;
   return id;
}

function closeWindow( win ) {
   try { if ( win && !win.isNull ) win.forceClose(); } catch ( e ) { /* already gone */ }
}

function readSetting( key, type, fallback ) {
   try {
      let v = Settings.read( SETTINGS_KEY + key, type );
      return ( Settings.lastReadOK && v !== null && v !== undefined ) ? v : fallback;
   } catch ( e ) {
      return fallback;
   }
}

function writeSetting( key, type, value ) {
   try { Settings.write( SETTINGS_KEY + key, type, value ); } catch ( e ) { /* non-fatal */ }
}

// ============================================================
//  Image scale detection: astrometric solution (view properties) first,
//  then FITS optics keywords. Returns { scale, source, focalMm, pixelUm };
//  scale is null when nothing usable was found.
// ============================================================
function keywordDict( win ) {
   let d = {};
   try {
      let kw = win.keywords;
      for ( let i = 0; i < kw.length; ++i )
         d[ kw[i].name.trim().toUpperCase() ] =
            String( kw[i].value ).trim().replace( /'/g, "" ).trim();
   } catch ( e ) { /* no keywords */ }
   return d;
}

// 2x2 matrix as [ a11, a12, a21, a22 ]. Plain and typed arrays are checked
// FIRST: under V8 they also have an .at() method, but it takes one index,
// so the Matrix-style L.at( row, col ) call would silently read garbage.
function mat22( L ) {
   if ( L == null ) return null;
   if ( Array.isArray( L ) || ArrayBuffer.isView( L ) ) {
      if ( L.length >= 4 ) return [ L[0], L[1], L[2], L[3] ];                  // flat, row-major
      if ( L.length === 2 && L[0] && L[0].length >= 2 && L[1] && L[1].length >= 2 )
         return [ L[0][0], L[0][1], L[1][0], L[1][1] ];                        // nested rows
      return null;
   }
   if ( typeof L.at === "function" ) return [ L.at( 0, 0 ), L.at( 0, 1 ), L.at( 1, 0 ), L.at( 1, 1 ) ];
   return null;
}

const SOLUTION_MATRIX_PROPERTIES = [
   "AstrometricSolution:LinearTransformationMatrix",
   "PCL:AstrometricSolution:LinearTransformationMatrix"
];

function detectImageScale( view ) {
   let r = { scale: null, source: "not found — enter focal length and pixel size", focalMm: null, pixelUm: null };
   if ( !view || view.isNull )
      return r;

   let d = keywordDict( view.window );
   let focal = parseFloat( d[ "FOCALLEN" ] );
   let pixel = parseFloat( d[ "XPIXSZ" ] );          // most capture programs store the binned size
   if ( isFinite( focal ) && focal > 0 ) r.focalMm = focal;
   if ( isFinite( pixel ) && pixel > 0 ) r.pixelUm = pixel;

   try {
      // PixInsight 1.9.4 (ImageSolver) stores it WITHOUT the "PCL:" prefix, as a
      // 2x2 Matrix in degrees per pixel; the prefixed name is kept as a fallback.
      let P = SOLUTION_MATRIX_PROPERTIES.find( function( n ) { return view.hasProperty && view.hasProperty( n ); } );
      if ( P ) {
         let L = mat22( view.propertyValue( P ) );      // degrees per pixel
         if ( L ) {
            let s = Math.sqrt( Math.abs( L[0]*L[3] - L[1]*L[2] ) ) * 3600;
            if ( isFinite( s ) && s > 0 ) {
               r.scale = s;
               r.source = "astrometric solution";
               return r;
            }
         }
      }
   } catch ( e ) { /* fall through to FITS keywords */ }

   if ( r.focalMm && r.pixelUm ) {
      r.scale = imageScaleArcsec( r.focalMm, r.pixelUm );
      r.source = "FITS keywords FOCALLEN / XPIXSZ";
   }
   return r;
}

// ============================================================
//  Optics type and mode texts shown in the dialog and the log
// ============================================================
var OPTICS_OBSTRUCTED = 0;      // reflector, SCT, RASA: has a central obstruction
var OPTICS_REFRACTOR  = 1;      // no obstruction: only diffraction removal makes sense

var MODE_ITEMS = [              // combo items, in MODE_* order
   "Restore obstruction loss (recommended)",
   "Exact unobstructed equivalent",
   "Remove all diffraction (experimental)"
];

// Short name for the log.
function modeName( mode, refractor ) {
   if ( refractor ) return "refractor: remove diffraction";
   if ( mode === MODE_IDEAL_APERTURE ) return "remove all diffraction";
   if ( mode === MODE_TRUE_EQUIVALENT ) return "exact unobstructed equivalent";
   return "restore obstruction loss";
}

// What the selected mode does, in plain words, shown under the mode list.
function modeDescription( mode, refractor ) {
   if ( refractor )
      return "<p><b>Refractor:</b> there is no obstruction to correct, so the script removes the " +
             "blur of the lens's own diffraction, as if the aperture were perfect. Experimental: it " +
             "raises the noise, most where seeing has already erased the detail. <i>Max boost</i> caps " +
             "the strongest boost; 1.5-2 is a good start for seeing-limited data.</p>";
   if ( mode === MODE_IDEAL_APERTURE )
      return "<p>Restores the obstruction loss <b>and</b> removes the aperture's own diffraction blur: " +
             "sharper than an unobstructed telescope of the same size. Experimental: much more noise. " +
             "<i>Max boost</i> caps the strongest boost.</p>";
   if ( mode === MODE_TRUE_EQUIVALENT )
      return "<p>Makes the image exactly what an unobstructed telescope of the same aperture would " +
             "give: restores the lost medium-scale contrast and also takes away the slight extra " +
             "fine-detail contrast an obstructed telescope has.</p>";
   return "<p>Gives back the medium-scale contrast that the secondary mirror takes away, up to what " +
          "an unobstructed telescope (like a refractor) of the same aperture would show. Never " +
          "lowers contrast anywhere, adds the least noise.</p>";
}

// ============================================================
//  Dialog
// ============================================================
var ObstructionCorrectionDialog = class extends Dialog {
   constructor() {
      super();
      var self = this;

      this.windowTitle = "ObstructionCorrection v" + VERSION;
      this.optics = obstructedOptics( OPTICS );
      // Where the image scale came from: "solution" (plate solution), "fits"
      // (FOCALLEN / XPIXSZ keywords) or "" (focal length and pixel size fields).
      // The image's own metadata outranks a focal length picked from the list.
      this.scaleOrigin = "";

      let labelWidth = this.font.width( "Saturation threshold:" ) + 8;

      function makeLabel( text ) {
         let l = new Label( self );
         l.text = text;
         l.textAlignment = TextAlign_Right | TextAlign_VertCenter;
         l.minWidth = labelWidth;
         return l;
      }
      function makeRow( label, control ) {
         let s = new HorizontalSizer;
         s.spacing = 4;
         s.add( makeLabel( label ) );
         s.add( control, 100 );
         return s;
      }
      function makeNumeric( label, lo, hi, precision, value, tip, onChange ) {
         let n = new NumericControl( self );
         n.label.text = label;
         n.label.minWidth = labelWidth;
         n.setRange( lo, hi );
         n.slider.setRange( 0, 1000 );
         n.setPrecision( precision );
         n.setValue( value );
         n.toolTip = tip;
         n.onValueUpdated = function( v ) { onChange( v ); };
         return n;
      }

      // ---- intro ---------------------------------------------------------
      this.helpLabel = new Label( this );
      this.helpLabel.wordWrapping = true;
      this.helpLabel.useRichText = true;
      this.helpLabel.text =
         "<p><b>ObstructionCorrection</b> — restores the medium-scale contrast that a " +
         "telescope's central obstruction removes. Apply to <b>linear</b> data " +
         "(before any stretch), ideally before noise reduction. For a refractor choose " +
         "<b>Optics: Refractor</b>.</p>";

      // ---- target --------------------------------------------------------
      this.viewList = new ViewList( this );
      this.viewList.getMainViews();
      if ( !ImageWindow.activeWindow.isNull )
         this.viewList.currentView = ImageWindow.activeWindow.mainView;
      this.viewList.onViewSelected = function( view ) { self.detectScale(); self.updateReadout(); };

      // ---- optics --------------------------------------------------------
      this.opticsTypeCombo = new ComboBox( this );
      this.opticsTypeCombo.addItem( "With central obstruction (reflector, SCT, RASA)" );
      this.opticsTypeCombo.addItem( "Refractor (no obstruction)" );
      this.opticsTypeCombo.toolTip =
         "<p>With a central obstruction the script restores the contrast the secondary mirror removes.</p>" +
         "<p>A refractor has nothing to restore; the script then removes the lens's own diffraction blur " +
         "(experimental), and the obstruction and mode settings are hidden.</p>";
      this.opticsTypeCombo.onItemSelected = function() { self.updateOpticsControls(); self.updateReadout(); };

      this.telescopeCombo = new ComboBox( this );
      this.telescopeCombo.addItem( "Custom (enter values below)" );
      for ( let i = 0; i < this.optics.length; ++i )
         this.telescopeCombo.addItem( opticsLabel( this.optics[i] ) );
      this.telescopeCombo.toolTip =
         "Telescopes with a central obstruction. Picking one fills aperture, obstruction " +
         "and focal length; the fields stay editable.";
      this.telescopeCombo.onItemSelected = function( index ) { self.applyTelescope( index ); };

      this.aperture = makeNumeric( "Aperture (mm):", 20, 1000, 0, DEFAULT_APERTURE_MM,
         "Clear aperture diameter.", function() { self.markCustom(); self.updateReadout(); } );
      this.obstruction = makeNumeric( "Obstruction (%):", 0, 70, 1, DEFAULT_OBSTRUCTION_PCT,
         "Linear central obstruction: secondary (or its baffle) diameter as a percentage of the aperture diameter. " +
         "For a refractor choose Optics: Refractor instead.",
         function() { self.markCustom(); self.updateReadout(); } );
      this.focal = makeNumeric( "Focal length (mm):", 50, 6000, 0, DEFAULT_FOCAL_MM,
         "Effective focal length, including any reducer or Barlow. Only used to derive the image scale.",
         function() { self.markCustom(); self.opticsEdited(); self.updateReadout(); } );
      this.pixel = makeNumeric( "Pixel size (um):", 1, 30, 2, DEFAULT_PIXEL_UM,
         "Pixel size of the image as it is now, i.e. after binning. Only used to derive the image scale.",
         function() { self.opticsEdited(); self.updateReadout(); } );
      this.scale = makeNumeric( "Image scale (\"/px):", 0.02, 30, 3, imageScaleArcsec( DEFAULT_FOCAL_MM, DEFAULT_PIXEL_UM ),
         "Arcseconds per pixel of this image. Taken from the plate solution when there is one " +
         "(correct for drizzled or resampled data); otherwise from focal length and pixel size. Editable.",
         function() { self.scaleOrigin = ""; self.scaleSource.text = "Image scale: entered manually"; self.updateReadout(); } );
      this.scaleSource = new Label( this );
      this.scaleSource.text = "";

      this.telescopeLabel = makeLabel( "Telescope:" );
      let telescopeRow = new HorizontalSizer;
      telescopeRow.spacing = 4;
      telescopeRow.add( this.telescopeLabel );
      telescopeRow.add( this.telescopeCombo, 100 );

      this.telescopeGroup = new GroupBox( this );
      this.telescopeGroup.title = "Optics";
      this.telescopeGroup.sizer = new VerticalSizer;
      this.telescopeGroup.sizer.margin = 6;
      this.telescopeGroup.sizer.spacing = 4;
      this.telescopeGroup.sizer.add( makeRow( "Optics:", this.opticsTypeCombo ) );
      this.telescopeGroup.sizer.add( telescopeRow );
      this.telescopeGroup.sizer.add( this.aperture );
      this.telescopeGroup.sizer.add( this.obstruction );
      this.telescopeGroup.sizer.add( this.focal );
      this.telescopeGroup.sizer.add( this.pixel );
      this.telescopeGroup.sizer.add( this.scale );
      this.telescopeGroup.sizer.add( this.scaleSource );

      // ---- correction ----------------------------------------------------
      this.bandCombo = new ComboBox( this );
      this.bandCombo.addItem( "Auto (R, G, B per channel; Luminance for mono)" );
      for ( let i = 0; i < BANDS.length; ++i )
         this.bandCombo.addItem( BANDS[i].label );
      this.bandCombo.toolTip = "Wavelength band of the data. Pick the filter for narrowband or mono-filter images.";
      this.bandCombo.onItemSelected = function() { self.updateReadout(); };

      this.modeCombo = new ComboBox( this );
      for ( let i = 0; i < MODE_ITEMS.length; ++i )
         this.modeCombo.addItem( MODE_ITEMS[i] );
      this.modeCombo.toolTip = "What the correction aims for; the text below the list explains the selected mode.";
      this.modeCombo.onItemSelected = function() { self.updateModeControls(); self.updateReadout(); };
      this.modeLabel = makeLabel( "Mode:" );
      let modeRow = new HorizontalSizer;
      modeRow.spacing = 4;
      modeRow.add( this.modeLabel );
      modeRow.add( this.modeCombo, 100 );

      this.modeDescription = new Label( this );
      this.modeDescription.wordWrapping = true;
      this.modeDescription.useRichText = true;
      this.modeDescription.text = "";
      let descriptionRow = new HorizontalSizer;
      descriptionRow.addSpacing( labelWidth + 4 );
      descriptionRow.add( this.modeDescription, 100 );

      this.amount = makeNumeric( "Amount:", 0, 1, 2, DEFAULT_AMOUNT,
         "Strength of the correction. 1 = full physical correction, 0 = no change.",
         function() { self.updateReadout(); } );

      this.maxBoost = makeNumeric( "Max boost:", 1.5, 10, 2, DEFAULT_MAX_BOOST,
         "Diffraction removal only: the contrast gain is never larger than this at any scale " +
         "(Wiener limit). Higher = closer to a full diffraction inverse, and more noise.",
         function() { self.updateReadout(); } );

      this.protectBox = new CheckBox( this );
      this.protectBox.text = "Protect saturated stars";
      this.protectBox.checked = true;
      this.protectBox.toolTip =
         "Saturated pixels are not linear, so filtering them draws dark rings. " +
         "This keeps the original image in and around them.";
      this.satThreshold = makeNumeric( "Saturation threshold:", 0.5, 1, 3, DEFAULT_SAT_THRESHOLD,
         "Pixels at or above this value are treated as saturated.", function() {} );

      this.inPlaceBox = new CheckBox( this );
      this.inPlaceBox.text = "Replace the target image (undoable, respects an active mask)";
      this.inPlaceBox.checked = false;
      this.inPlaceBox.toolTip = "Off: the result is a new image <id>_oc and the target is untouched.";

      this.correctionGroup = new GroupBox( this );
      this.correctionGroup.title = "Correction";
      this.correctionGroup.sizer = new VerticalSizer;
      this.correctionGroup.sizer.margin = 6;
      this.correctionGroup.sizer.spacing = 4;
      this.correctionGroup.sizer.add( makeRow( "Band:", this.bandCombo ) );
      this.correctionGroup.sizer.add( modeRow );
      this.correctionGroup.sizer.add( descriptionRow );
      this.correctionGroup.sizer.add( this.amount );
      this.correctionGroup.sizer.add( this.maxBoost );
      this.correctionGroup.sizer.add( this.protectBox );
      this.correctionGroup.sizer.add( this.satThreshold );
      this.correctionGroup.sizer.add( this.inPlaceBox );

      // ---- read-out ------------------------------------------------------
      this.readout = new Label( this );
      this.readout.wordWrapping = true;
      this.readout.useRichText = true;
      this.readout.text = "";

      // ---- buttons -------------------------------------------------------
      this.ok_Button = new PushButton( this );
      this.ok_Button.text = "Run";
      this.ok_Button.onClick = function() { self.ok(); };
      this.cancel_Button = new PushButton( this );
      this.cancel_Button.text = "Cancel";
      this.cancel_Button.onClick = function() { self.cancel(); };
      this.buttonSizer = new HorizontalSizer;
      this.buttonSizer.addStretch();
      this.buttonSizer.add( this.ok_Button );
      this.buttonSizer.addSpacing( 8 );
      this.buttonSizer.add( this.cancel_Button );

      this.sizer = new VerticalSizer;
      this.sizer.margin = 8;
      this.sizer.spacing = 6;
      this.sizer.add( this.helpLabel );
      this.sizer.add( makeRow( "Target image:", this.viewList ) );
      this.sizer.add( this.telescopeGroup );
      this.sizer.add( this.correctionGroup );
      this.sizer.add( this.readout );
      this.sizer.addSpacing( 4 );
      this.sizer.add( this.buttonSizer );

      this.loadSettings();
      this.detectScale();
      this.updateOpticsControls();
      this.updateReadout();

      this.adjustToContents();
      this.setMinWidth( 520 );
   }

   isRefractor() {
      return this.opticsTypeCombo.currentItem === OPTICS_REFRACTOR;
   }

   // The mode actually used: a refractor can only have its diffraction removed.
   effectiveMode() {
      return this.isRefractor() ? MODE_IDEAL_APERTURE : this.modeFromCombo();
   }

   // Refractor: hide what does not apply (telescope list, obstruction, mode list).
   updateOpticsControls() {
      let shown = !this.isRefractor();
      this.telescopeLabel.visible = shown;
      this.telescopeCombo.visible = shown;
      this.obstruction.visible = shown;
      this.modeLabel.visible = shown;
      this.modeCombo.visible = shown;
      this.updateModeControls();
      this.adjustToContents();
   }

   // Description of the mode in use; Max boost only where it applies.
   updateModeControls() {
      let mode = this.effectiveMode();
      this.modeDescription.text = modeDescription( mode, this.isRefractor() );
      this.maxBoost.visible = ( mode === MODE_IDEAL_APERTURE );
   }

   // Mode index of the combo (its items are in MODE_* order).
   modeFromCombo() {
      let i = this.modeCombo.currentItem;
      return ( i === MODE_TRUE_EQUIVALENT || i === MODE_IDEAL_APERTURE ) ? i : MODE_RESTORE_ONLY;
   }

   // Telescope picked from the list: fill the optics fields. The catalogue
   // focal length is used only when the image carries no scale of its own.
   applyTelescope( index ) {
      if ( index <= 0 || index > this.optics.length )
         return;
      let o = this.optics[ index - 1 ];
      this.aperture.setValue( o.apertureMm );
      this.obstruction.setValue( 100 * opticsObstructionRatio( o ) );
      if ( o.focalMm > 0 && !this.scaleOrigin )
         this.focal.setValue( o.focalMm );
      this.scaleFromOptics();
      this.updateReadout();
   }

   // A manual edit of the optics means the list no longer describes them.
   markCustom() {
      this.telescopeCombo.currentItem = 0;
   }

   // The user typed a focal length or pixel size: that overrides the FITS
   // keywords, but never a plate solution.
   opticsEdited() {
      if ( this.scaleOrigin === "fits" )
         this.scaleOrigin = "";
      this.scaleFromOptics();
   }

   // Derive the scale from focal length + pixel size, unless the image's
   // own metadata already provides it.
   scaleFromOptics() {
      if ( this.scaleOrigin )
         return;
      this.scale.setValue( imageScaleArcsec( this.focal.value, this.pixel.value ) );
      this.scaleSource.text = "Image scale: from focal length and pixel size";
   }

   // Read the scale of the selected view.
   detectScale() {
      let view = this.viewList.currentView;
      let r = detectImageScale( view );
      this.scaleOrigin = "";
      if ( r.focalMm )
         this.focal.setValue( r.focalMm );
      if ( r.pixelUm )
         this.pixel.setValue( r.pixelUm );
      if ( r.scale ) {
         this.scale.setValue( r.scale );
         this.scaleSource.text = "Image scale: from " + r.source;
         this.scaleOrigin = ( r.source === "astrometric solution" ) ? "solution" : "fits";
      } else
         this.scaleFromOptics();
   }

   // Band id per channel for the given colour layout.
   bandIds( isColor ) {
      let i = this.bandCombo.currentItem;
      if ( i <= 0 )
         return isColor ? [ "R", "G", "B" ] : [ "L" ];
      let id = BANDS[ i - 1 ].id;
      return isColor ? [ id, id, id ] : [ id ];
   }

   // Everything the processing step needs, read from the controls.
   parameters() {
      let view = this.viewList.currentView;
      let isColor = ( view && !view.isNull ) ? view.image.isColor : false;
      return {
         view: view,
         isColor: isColor,
         refractor: this.isRefractor(),
         telescope: this.isRefractor() ? "refractor"
            : this.telescopeCombo.currentItem > 0
               ? opticsLabel( this.optics[ this.telescopeCombo.currentItem - 1 ] ) : "custom",
         apertureMm: this.aperture.value,
         eps: this.isRefractor() ? 0 : this.obstruction.value / 100,
         scale: this.scale.value,
         bands: this.bandIds( isColor ),
         mode: this.effectiveMode(),
         amount: this.amount.value,
         maxBoost: this.maxBoost.value,
         protect: this.protectBox.checked,
         satThreshold: this.satThreshold.value,
         inPlace: this.inPlaceBox.checked
      };
   }

   updateReadout() {
      try {
         let p = this.parameters();
         let band = bandById( p.bands[ p.bands.length > 1 ? 1 : 0 ] );     // green for colour
         let cutoffs = bandCutoffs( band, p.apertureMm, p.scale );
         let mid = cutoffs[ cutoffs.length >> 1 ];
         let st = bandStats( cutoffs, p.eps, p.mode, p.amount, p.maxBoost );
         let q = 0.5 / mid;
         let note = "";
         if ( !( p.eps > 0 ) && p.mode !== MODE_IDEAL_APERTURE )
            note = "<br/><i>No obstruction entered: for a refractor choose Optics: Refractor.</i>";
         else if ( st.peak < 1.03 )
            note = "<br/><i>Almost nothing to correct at this sampling.</i>";
         this.readout.text =
            "<p>Diffraction cutoff: <b>" + mid.toFixed( 2 ) + "</b> cycles/px" +
            " &nbsp; Nyquist is at <b>" + ( 100 * q ).toFixed( 0 ) + "%</b> of cutoff<br/>" +
            "Largest contrast boost: <b>&times;" + st.peak.toFixed( 2 ) + "</b>" +
            " &nbsp; Background noise: <b>" + ( st.noise >= 1 ? "+" : "" ) +
            ( 100 * ( st.noise - 1 ) ).toFixed( 0 ) + "%</b>" + note + "</p>";
      } catch ( e ) {
         this.readout.text = "";
      }
   }

   loadSettings() {
      this.aperture.setValue( readSetting( "aperture", DataType_Double, DEFAULT_APERTURE_MM ) );
      this.obstruction.setValue( readSetting( "obstruction", DataType_Double, DEFAULT_OBSTRUCTION_PCT ) );
      this.focal.setValue( readSetting( "focal", DataType_Double, DEFAULT_FOCAL_MM ) );
      this.pixel.setValue( readSetting( "pixel", DataType_Double, DEFAULT_PIXEL_UM ) );
      this.amount.setValue( readSetting( "amount", DataType_Double, DEFAULT_AMOUNT ) );
      this.maxBoost.setValue( readSetting( "maxBoost", DataType_Double, DEFAULT_MAX_BOOST ) );
      this.satThreshold.setValue( readSetting( "satThreshold", DataType_Double, DEFAULT_SAT_THRESHOLD ) );
      this.protectBox.checked = readSetting( "protect", DataType_Boolean, true );
      this.inPlaceBox.checked = readSetting( "inPlace", DataType_Boolean, false );
      let opticsType = readSetting( "opticsType", DataType_Int32, OPTICS_OBSTRUCTED );
      this.opticsTypeCombo.currentItem = ( opticsType === OPTICS_REFRACTOR ) ? OPTICS_REFRACTOR : OPTICS_OBSTRUCTED;
      let mode = readSetting( "mode", DataType_Int32, 0 );
      this.modeCombo.currentItem = ( mode === MODE_TRUE_EQUIVALENT || mode === MODE_IDEAL_APERTURE ) ? mode : MODE_RESTORE_ONLY;
      let band = readSetting( "band", DataType_Int32, 0 );
      this.bandCombo.currentItem = ( band >= 0 && band <= BANDS.length ) ? band : 0;
      // The telescope is remembered by maker + model, so a re-sorted or extended list still matches.
      let key = readSetting( "telescope", DataType_String, "" );
      let index = 0;
      for ( let i = 0; i < this.optics.length; ++i )
         if ( opticsKey( this.optics[i] ) === key )
            index = i + 1;
      this.telescopeCombo.currentItem = index;
   }

   saveSettings() {
      writeSetting( "aperture", DataType_Double, this.aperture.value );
      writeSetting( "obstruction", DataType_Double, this.obstruction.value );
      writeSetting( "focal", DataType_Double, this.focal.value );
      writeSetting( "pixel", DataType_Double, this.pixel.value );
      writeSetting( "amount", DataType_Double, this.amount.value );
      writeSetting( "maxBoost", DataType_Double, this.maxBoost.value );
      writeSetting( "satThreshold", DataType_Double, this.satThreshold.value );
      writeSetting( "protect", DataType_Boolean, this.protectBox.checked );
      writeSetting( "inPlace", DataType_Boolean, this.inPlaceBox.checked );
      writeSetting( "mode", DataType_Int32, this.modeCombo.currentItem );
      writeSetting( "opticsType", DataType_Int32, this.opticsTypeCombo.currentItem );
      writeSetting( "band", DataType_Int32, this.bandCombo.currentItem );
      writeSetting( "telescope", DataType_String,
         this.telescopeCombo.currentItem > 0
            ? opticsKey( this.optics[ this.telescopeCombo.currentItem - 1 ] ) : "" );
   }
};

// ============================================================
//  Processing building blocks
// ============================================================

// Hidden 32-bit float window holding a correction kernel (it has negative
// lobes; Convolution divides by the plain sum, which is 1).
function createKernelWindow( kernel, baseId ) {
   let n = kernel.size;
   let win = new ImageWindow( n, n, 1, 32, true, false, uniqueViewId( baseId ) );
   let view = win.mainView;
   view.beginProcess( UndoFlag_NoSwapFile );
   let img = view.image;
   for ( let y = 0; y < n; ++y )
      for ( let x = 0; x < n; ++x )
         img.setSample( kernel.data[ y*n + x ], x, y, 0 );
   view.endProcess();
   return win;
}

// Evaluate a PixelMath expression against `view` into a NEW hidden
// grayscale 32-bit float window; returns that window.
function pixelMathToNewGray( view, expression, baseId ) {
   let id = uniqueViewId( baseId );
   let P = new PixelMath;
   P.expression = expression;
   P.useSingleExpression = true;
   P.rescale = false;
   P.truncate = false;
   P.createNewImage = true;
   P.showNewImage = false;
   P.newImageId = id;
   P.newImageColorSpace = PixelMath.Gray;
   P.newImageSampleFormat = PixelMath.f32;
   if ( !P.executeOn( view ) )
      throw new Error( "PixelMath failed for: " + expression );
   let win = ImageWindow.windowById( id );
   if ( win.isNull )
      throw new Error( "PixelMath did not create the image " + id );
   return win;
}

function convolveWithKernel( view, kernelView ) {
   let P = new Convolution;
   P.mode = Convolution.Image;
   P.viewId = kernelView.id;
   if ( !P.executeOn( view ) )
      throw new Error( "Convolution failed on " + view.id );
}

function gaussianBlur( view, sigma ) {
   let P = new Convolution;
   P.mode = Convolution.Parametric;
   P.sigma = sigma;
   trySet( P, "shape", 2.0 );          // 2 = Gaussian
   trySet( P, "aspectRatio", 1.0 );
   trySet( P, "rotationAngle", 0 );
   if ( !P.executeOn( view ) )
      throw new Error( "Convolution (Gaussian) failed on " + view.id );
}

// PixelMath's new image starts with no FITS header and no properties, so a
// plate solution would be lost. Carry over both (verified in PixInsight
// 1.9.4: keywords assignment + copyAstrometricSolution). Returns what was copied.
function copyMetadata( fromWin, toWin ) {
   let copied = [];
   if ( !fromWin || !toWin || toWin.isNull )
      return copied;
   try { toWin.keywords = fromWin.keywords; copied.push( "FITS keywords" ); } catch ( e ) { /* not essential */ }
   try {
      if ( fromWin.hasAstrometricSolution ) {
         toWin.copyAstrometricSolution( fromWin );
         copied.push( "astrometric solution" );
      }
   } catch ( e ) { /* not essential */ }
   return copied;
}

// ============================================================
//  The correction itself
// ============================================================
function applyCorrection( p ) {
   let view = p.view;
   let win = view.window;
   let nch = p.isColor ? 3 : 1;
   let temps = [];                       // every hidden window, closed at the end
   let maskWasEnabled = false;

   try { maskWasEnabled = win.maskEnabled; } catch ( e ) { /* no mask support */ }

   try {
      // The temporary images must be computed from the unmasked target.
      if ( maskWasEnabled ) win.maskEnabled = false;

      // ---- kernels (one per distinct band) ---------------------------------
      let kernelWins = {};
      for ( let c = 0; c < nch; ++c ) {
         let bandId = p.bands[c];
         if ( kernelWins[ bandId ] )
            continue;
         let cutoffs = bandCutoffs( bandById( bandId ), p.apertureMm, p.scale );
         let size = chooseKernelSize( Math.min.apply( null, cutoffs ), p.mode );
         let kernel = buildKernel( cutoffs, p.eps, p.mode, p.amount, size, p.maxBoost );
         let st = bandStats( cutoffs, p.eps, p.mode, p.amount, p.maxBoost );
         log( "Kernel " + bandId + "        : " + size + " x " + size + " px   cutoff "
              + cutoffs[ cutoffs.length >> 1 ].toFixed( 3 ) + " cycles/px   peak boost x"
              + st.peak.toFixed( 3 ) + "   noise x" + kernelNoiseGain( kernel ).toFixed( 3 ) );
         let kw = createKernelWindow( kernel, "oc_kernel_" + bandId );
         temps.push( kw );
         kernelWins[ bandId ] = kw;
      }

      // ---- filtered copy of each channel -----------------------------------
      let filteredIds = [];
      for ( let c = 0; c < nch; ++c ) {
         let tw = pixelMathToNewGray( view, p.isColor ? "$T[" + c + "]" : "$T", "oc_channel_" + c );
         temps.push( tw );
         convolveWithKernel( tw.mainView, kernelWins[ p.bands[c] ].mainView );
         filteredIds.push( tw.mainView.id );
         log( "Channel " + c + "        : filtered (" + p.bands[c] + ")" );
      }

      // ---- saturated-star protection mask ----------------------------------
      let maskId = null;
      if ( p.protect ) {
         let t = p.satThreshold.toFixed( 4 );
         let expr = p.isColor ? "iif( max( $T[0], $T[1], $T[2] ) >= " + t + ", 1, 0 )"
                              : "iif( $T >= " + t + ", 1, 0 )";
         let mw = pixelMathToNewGray( view, expr, "oc_starmask" );
         temps.push( mw );
         gaussianBlur( mw.mainView, STAR_MASK_SIGMA );
         maskId = mw.mainView.id;
         log( "Star protection  : pixels >= " + t + ", grown by a " + STAR_MASK_SIGMA + " px blur" );
      }

      // ---- combine ----------------------------------------------------------
      function channelExpression( c ) {
         let src = p.isColor ? "$T[" + c + "]" : "$T";
         if ( !maskId )
            return filteredIds[c];
         let w = "min( 1, " + STAR_MASK_GAIN + "*" + maskId + " )";
         return w + "*" + src + " + ( 1 - " + w + " )*" + filteredIds[c];
      }

      let P = new PixelMath;
      P.expression = channelExpression( 0 );
      if ( p.isColor ) {
         P.expression1 = channelExpression( 1 );
         P.expression2 = channelExpression( 2 );
         P.useSingleExpression = false;
      } else
         P.useSingleExpression = true;
      P.rescale = false;
      P.truncate = true;
      trySet( P, "truncateLower", 0 );
      trySet( P, "truncateUpper", 1 );

      let resultId;
      if ( p.inPlace ) {
         if ( maskWasEnabled ) win.maskEnabled = true;      // let the user's mask apply
         P.createNewImage = false;
         if ( !P.executeOn( view ) )
            throw new Error( "PixelMath failed while writing the result" );
         resultId = view.id;
      } else {
         resultId = uniqueViewId( view.id + "_oc" );
         P.createNewImage = true;
         P.showNewImage = true;
         P.newImageId = resultId;
         P.newImageColorSpace = PixelMath.SameAsTarget;
         P.newImageSampleFormat = PixelMath.f32;
         if ( !P.executeOn( view ) )
            throw new Error( "PixelMath failed while writing the result" );
         let copied = copyMetadata( win, ImageWindow.windowById( resultId ) );
         if ( copied.length )
            log( "Metadata         : copied " + copied.join( " and " ) );
      }
      return resultId;
   } finally {
      for ( let i = 0; i < temps.length; ++i )
         closeWindow( temps[i] );
      try { if ( maskWasEnabled ) win.maskEnabled = true; } catch ( e ) { /* ignore */ }
   }
}

// ============================================================
//  MAIN
// ============================================================
function main() {
   Console.show();
   log( "============================================================" );
   log( " ObstructionCorrection v" + VERSION + "  —  central-obstruction contrast recovery" );
   log( "============================================================" );

   let dlg = new ObstructionCorrectionDialog;
   if ( !dlg.execute() )
      return;                                   // cancelled
   dlg.saveSettings();

   let p = dlg.parameters();
   let view = p.view;
   if ( !view || view.isNull ) {
      log( "ERROR: No target image selected. Open an image and pick it in the dialog." );
      return;
   }
   if ( !( p.eps >= 0 && p.eps < 1 ) || !( p.apertureMm > 0 ) || !( p.scale > 0 ) ) {
      log( "ERROR: aperture, obstruction and image scale are out of range "
           + "(aperture and scale must be positive, obstruction 0-99 %)." );
      return;
   }
   if ( p.eps === 0 && p.mode !== MODE_IDEAL_APERTURE ) {
      log( "Nothing to do: there is no central obstruction to correct. For a refractor choose "
           + "Optics: Refractor, which removes the lens's own diffraction blur instead." );
      return;
   }

   let image = view.image;
   log( "Target           : " + view.fullId + "   " + image.width + " x " + image.height
        + "  (" + ( p.isColor ? "RGB" : "mono" ) + ")" );
   log( "Telescope        : " + p.telescope );
   log( "Optics           : aperture " + p.apertureMm.toFixed( 0 ) + " mm   obstruction "
        + ( 100 * p.eps ).toFixed( 1 ) + " %" + ( p.eps === 0 ? " (clear aperture)" : "" )
        + "   scale " + p.scale.toFixed( 3 ) + " \"/px" );
   log( "Correction       : bands " + p.bands.join( "/" ) + "   "
        + modeName( p.mode, p.refractor )
        + ( p.mode === MODE_IDEAL_APERTURE ? " (max boost x" + p.maxBoost.toFixed( 2 ) + ")" : "" )
        + "   amount " + p.amount.toFixed( 2 ) );

   try {
      let med = image.median();
      if ( med > NONLINEAR_MEDIAN )
         log( "WARNING: image median is " + med.toFixed( 3 ) + " — this looks like a STRETCHED image. "
              + "The correction is only physically valid on linear data." );
   } catch ( e ) { /* statistics unavailable — not essential */ }

   if ( p.amount <= 0 ) {
      log( "Amount is 0 — nothing to do." );
      return;
   }

   let resultId = applyCorrection( p );

   log( "------------------------------------------------------------" );
   log( " Result           : " + resultId + ( p.inPlace ? "  (replaced; undo with Ctrl/Cmd+Z)" : "  (new image)" ) );
   log( "============================================================" );
}

try {
   main();
} catch ( e ) {
   log( "ERROR: unexpected exception — " + errText( e ) );
}
