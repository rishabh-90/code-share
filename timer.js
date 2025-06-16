// Keep track of last committed value to detect start changes
const prevValueRef = React.useRef<[Moment|null, Moment|null]>(value);
React.useEffect(() => {
  prevValueRef.current = value;
}, [value]);

const handleAccept = ([rawStart, rawEnd]: [Moment|null, Moment|null]) => {
  const [prevStart] = prevValueRef.current;

  // 1) nothing selected → clear both
  if (!rawStart) {
    onChange([null, null]);
    prevValueRef.current = [null, null];
    return;
  }

  // 2) only start selected → end = start + 2 days
  if (rawStart && !rawEnd) {
    const end = rawStart.clone().add(2, 'days');
    onChange([rawStart, end]);
    prevValueRef.current = [rawStart, end];
    return;
  }

  // 3) both selected
  const startChanged = !prevStart || !rawStart.isSame(prevStart, 'day');
  if (startChanged) {
    const span = rawEnd.diff(rawStart, 'days');
    // if reversed or >30 days → reset end to start + 2
    if (!rawEnd.isAfter(rawStart) || span > 30) {
      const end = rawStart.clone().add(2, 'days');
      onChange([rawStart, end]);
      prevValueRef.current = [rawStart, end];
      return;
    }
  }

  // valid forward change of end-date only, or valid span ≤30
  onChange([rawStart, rawEnd!]);
  prevValueRef.current = [rawStart, rawEnd!];
};
