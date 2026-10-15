# TODO

Every routing key and every value it takes (t-0e99), in canonical order.

## Tasks

- [ ] DRAFT: a draft may carry every routing key
  - id: t-r001
  - model: opus
  - effort: high
  - groomer: haiku
  - groomer-effort: xhigh
  - reviewer: none
  - feedback: Fold this in.

- [ ] Worker on Haiku at low effort
  - id: t-r002
  - phase: new
  - model: haiku
  - effort: low
  - groomer: haiku
  - groomer-effort: medium
  - reviewer: none

- [ ] Groomer on hold, Opus reviews
  - id: t-r003
  - phase: backlog
  - model: opus
  - effort: medium
  - groomer: none
  - groomer-effort: low
  - reviewer: opus

- [ ] Sonnet at high effort
  - id: t-r004
  - phase: inprogress
  - model: sonnet
  - effort: high
  - groomer: opus
  - groomer-effort: medium
  - reviewer: sonnet

- [ ] Fable at xhigh, parked
  - id: t-r005
  - phase: feedback
  - model: fable
  - effort: xhigh
  - groomer: sonnet
  - groomer-effort: high
  - reviewer: fable
  - question: Which store?
    - answer:

- [ ] Only some keys set
  - id: t-r006
  - phase: review
  - model: sonnet
  - groomer: fable
  - reviewer: haiku
