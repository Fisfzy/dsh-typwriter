= Markup basics
<sec:basics>

This chapter is plain markup, which means the visual editor should render all of it as editable
content rather than as raw islands. Text can be *strong*, _emphasised_, `inline raw`,
#underline[underlined], #strike[struck through], #highlight[highlighted], and
#text(fill: rgb("#b33"))[coloured]. Superscripts#super[1] and subscripts#sub[2] exist too.

Smart typography should turn "straight quotes" into curly ones, 'singles' likewise, and turn
three dots ... into an ellipsis. An em dash --- like this --- and an en dash 1--10.

== Lists
<sec:lists>

- A bullet item.
- Another, with nested children:
  - A second level.
    - A third level, to check indentation survives the round trip.
- A bullet containing a #link("https://typst.app")[link with text] and a bare link:
  https://github.com/typst/typst

+ A numbered item.
+ The numbering is automatic.
  + Nested numbering restarts.
+ Back to the outer level.

/ Term: its definition, which is a term list rather than a bullet.
/ Another term: a second definition, long enough to wrap onto a second line so the layout of a
  hanging indent can be checked properly.

== Quotes and notes
<sec:quotes>

#quote(block: true, attribution: [Donald Knuth])[
  Science is what we understand well enough to explain to a computer. Art is everything else we
  do.
]

An inline #quote[quotation] sits in running text.

A footnote lives here.#footnote[Footnote text, which should be spell-checked as prose.] A
second one follows.#footnote[And a second body, to check numbering.]

== Raw blocks
<sec:raw>

Fenced raw with a language, which should be syntax-highlighted but never spell-checked:

```python
def fib(n: int) -> int:
    """Docstring, not prose."""
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

= Mathematics
<sec:math>

Inline math like $E = m c^2$ and $alpha != beta$ sits in running text, as does a sum
$sum_(k=1)^n k = (n(n+1))/2$. Opening any of them should hand the formula to the equation
editor rather than to a plain text box.

A display equation without a label:

$ integral_0^oo e^(-x^2) dif x = sqrt(pi)/2 $

A labelled one, which @eq:euler refers to:

$ e^(i pi) + 1 = 0 $ <eq:euler>

Because the style sets equation numbering, the preview numbers these. The editor deliberately
does not invent a number of its own: a labelled equation shows its label instead, and a
reference to it reads as the label rather than a guessed number.

A matrix, a case distinction, and an underbrace, all of which have their own syntax:

$ A = mat(1, 2, 3; 4, 5, 6; 7, 8, 9) quad op("tr")(A) = 15 $ <eq:matrix>

== References to equations
<sec:eqrefs>

@eq:euler is the famous one, @eq:matrix is the matrix. A reference to a section works the
same way: @sec:basics.
