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
    // if end is the same as or before start → treat that click as a new start
    if (!end.isAfter(start)) {
      const newStart = end;
      const newEnd = newStart.clone().add(2, 'days');
      setTempDate([newStart, newEnd]);
    } else {
      // a valid forward range
      setTempDate([start, end]);
    }
  }
};
