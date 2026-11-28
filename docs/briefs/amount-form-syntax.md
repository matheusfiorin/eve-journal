# Locale-independent editable ISK amounts

`formatAmount` produces text consumed by `parseAmount` and `parseIsk`. Their input grammar uses a decimal point
(`12.5m`, `1.25b`) and accepts commas as grouping separators.

With pt-BR as the default locale, JVM decimal formatting produced `12,5m`. Parsing that text removed the comma and
yielded 125 million instead of 12.5 million.

Use `Locale.ROOT` when formatting decimal tokens for these fields. Keep suffixes, sign, precision, trailing-zero
trimming, rounding and unit selection. This does not redefine the application's display locale or change numeric payloads.

`AmountFormatTest.formattedAmountsKeepTheirValueInEveryDeviceLocale` explicitly switches between en-US, pt-BR,
de-DE and ar-EG. It checks the full text and `parseAmount(formatAmount(value)) == value`, including negatives,
billions, fractional millions, thousands and unsuffixed integers. The original locale is restored in `finally`;
the regression test does not depend on the locale in which CI starts.

References: [Locale.ROOT](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Locale.html#ROOT),
[String.format with an explicit locale](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/String.html#format(java.util.Locale,java.lang.String,java.lang.Object...)).
