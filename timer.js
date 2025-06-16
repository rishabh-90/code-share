```ts
const handleDateChange = (newValue: [Moment | null, Moment | null]) => {
  setIsChangingDate(true);
  const [start, end] = newValue;

  // 1) nothing picked → clear both
  if (!start) {
    setTempDate([null, null]);
    return;
  }

  // 2) only start → default end = start + 2 days
  if (start && !end) {
    const defaultEnd = start.clone().add(2, 'days');
    setTempDate([start, defaultEnd]);
    return;
  }

  // 3) both picked
  if (start && end) {
    const diffDays = end.diff(start, 'days');

    // if reversed click (end ≤ start) OR span > 30 days
    if (!end.isAfter(start) || diffDays > 30) {
      // treat the click as a brand-new start: end = start + 2 days
      const newStart = start;
      const newEnd = newStart.clone().add(2, 'days');
      setTempDate([newStart, newEnd]);
    } else {
      // a valid forward range within 30 days
      setTempDate([start, end]);
    }
  }
};
```
