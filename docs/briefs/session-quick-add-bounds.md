# Keeping Add ISK quick additions within the form's bounds

The Add ISK chips previously formatted the sum without checking whether the parser would accept it. Cancelling a
negative correction exactly (for example `-10m` plus the `+10m` chip) wrote `0`, and going beyond `MAX_ADD` wrote
an out-of-range value. Both made the Add button unavailable.

`quickAddAmount` replaces the field only when the resulting amount is nonzero and within `MAX_ADD`. Otherwise it
preserves the current text. An empty or invalid field still starts from the chip's amount, and reaching the exact
limit is allowed. The helper accepts positive, bounded increments, so adding to a parsed bounded amount cannot
overflow a Long. It uses the existing form formatter/parser and does not submit or share anything.

`QuickAddAmountTest` checks each displayed chip at zero cancellation, the upper limit, the exact boundary and
negative corrections, plus empty/invalid input and a normal decimal amount. The locale-independent formatter fix
is a separate prerequisite; no parser grammar, numeric limit or payload is changed.
