import React, { useState, useEffect } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment';
import {
  DateRangePicker,
  LocalizationProvider,
  MultiInputDateRangeField,
  DateRange,
} from '@mui/x-date-pickers-pro';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import ClearIcon from '@mui/icons-material/Clear';
import moment, { Moment } from 'moment';

const StyledTitle = styled(Typography)({
  color: 'rgba(0, 0, 0, 0.6)',
  fontFamily: 'Roboto, Arial',
  fontWeight: 400,
  fontSize: '12px',
});

interface DateRangePickerProps {
  startDate?: Moment | null;
  endDate?: Moment | null;
  onChange?: (value: [Moment | null, Moment | null]) => void;
  onClear?: () => void;
  minDate?: Moment;
  maxDate?: Moment;
  title?: string;
}

const DateRangeSelectorWithMultiInput: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  onChange,
  onClear,
  minDate = moment().startOf('day'),
  maxDate = moment().add(7, 'days').endOf('day'),
  title = 'Date Range',
}) => {
  const [value, setValue] = useState<[Moment | null, Moment | null]>([startDate ?? null, endDate ?? null]);
  const [tempDate, setTempDate] = useState<[Moment | null, Moment | null]>([startDate ?? null, endDate ?? null]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const initial: [Moment | null, Moment | null] = [startDate ?? null, endDate ?? null];
    setValue(initial);
    setTempDate(initial);
  }, [startDate, endDate]);

  const handleAccept = (accepted: [Moment | null, Moment | null]) => {
    setValue(accepted);
    setTempDate(accepted);
    onChange?.(accepted);
    setOpen(false);
  };

  const handleClose = () => {
    setTempDate(value); // Revert changes
    setOpen(false);
  };

  const handleClear = () => {
    const cleared: [Moment | null, Moment | null] = [null, null];
    setValue(cleared);
    setTempDate(cleared);
    onChange?.(cleared);
    onClear?.();
  };

  return (
    <LocalizationProvider dateAdapter={AdapterMoment}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <StyledTitle>{title}</StyledTitle>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton onClick={() => setOpen(true)} size="small">
            <CalendarTodayIcon fontSize="small" />
          </IconButton>

          <DateRangePicker
            open={open}
            onOpen={() => setOpen(true)}
            onClose={handleClose}
            onAccept={handleAccept}
            value={tempDate}
            onChange={(newValue) => setTempDate(newValue)} // buffer only
            closeOnSelect={false}
            minDate={minDate}
            maxDate={maxDate}
            slots={{ field: MultiInputDateRangeField }}
            slotProps={{
              field: {
                sx: {
                  width: '220px',
                  marginTop: '5px',
                  '.MuiInputBase-root': {
                    border: 'none',
                    padding: '6px 0px',
                    backgroundColor: 'transparent',
                  },
                  '.MuiFormLabel-root': {
                    display: 'none',
                  },
                  '.MuiOutlinedInput-notchedOutline': {
                    border: 0,
                  },
                  '.MuiInputBase-input': {
                    padding: 0,
                    color: '#002072',
                  },
                },
              },
              actionBar: {
                actions: ['cancel', 'accept'],
              },
            }}
          />

          <IconButton onClick={handleClear} size="small">
            <ClearIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
    </LocalizationProvider>
  );
};

export default DateRangeSelectorWithMultiInput;
