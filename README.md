# pixinsight-scripts-mtf-recovery

A PixInsight (PJSR) script that recovers linear data from an image that was stretched with
a midtones transfer function (STF / HistogramTransformation), by applying the inverse MTF:

```
x = c0 + (c1 - c0) * mtf(1 - m, x')
```

Status: in design, no code yet. See [AGENTS.md](AGENTS.md) for the full spec and open
questions.

## Limitations
- Clipped pixels (below the shadows clip or above the highlights clip) can't be recovered.
- Integer (8/16-bit) sources lose shadow precision; work in 32-bit float.
- Any extra non-linear processing after the stretch makes recovery approximate.
