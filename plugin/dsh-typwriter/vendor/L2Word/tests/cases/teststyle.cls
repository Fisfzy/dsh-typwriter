\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{teststyle}[2026/01/01 test class for latex2word regression]
\LoadClass{article}
\RequirePackage{amsmath,amssymb}
% 这几条模拟期刊 .cls 里的数学简写：曾经因为只收集导言区而漏掉，
% 导致 \bbbr 被原样印进公式（MathType 不报错，静默降级）
\newcommand{\bbbr}{\mathbb{R}}
\newcommand{\bbbn}{\mathbb{N}}
\newcommand{\bbbz}{\mathbb{Z}}
\newcommand{\R}{\mathbb{R}}
\newcommand{\norm}[1]{\left\|#1\right\|}
\DeclareMathOperator{\argmin}{argmin}
\def\dd{\mathrm{d}}
