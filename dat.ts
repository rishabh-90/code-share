import React, { useState, useEffect } from 'react';
import { Box, IconButton } from '@mui/material';
import { DateRangePicker, LocalizationProvider } from '@mui/x-date-pickers-pro';
import { AdapterMoment } from '@mui/x-date-pickers/AdapterMoment';
import { MultiInputDateRangeField } from '@mui/x-date-pickers-pro/MultiInputDateRangeField';
import { DateRange } from '@mui/x-date-pickers-pro/models';
import ClearIcon from '@mui/icons-material/Clear';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import moment, { Moment } from 'moment';

interface DateRangePickerProps {
  startDate?: Moment | null;
  endDate?: Moment | null;
  onChange?: (dates: [Moment | null, Moment | null]) => void;
  onClear?: () => void;
  title?: string;
  minDate?: Moment;
  maxDate?: Moment;
}

export const DateRangeSelectorWithMultiInput: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  onChange,
  onClear,
  minDate = moment().startOf('day'),
  maxDate = moment().add(7, 'days').endOf('day'),
}) => {
  const [value, setValue] = useState<[Moment | null, Moment | null]>([startDate ?? null, endDate ?? null]);
  const [tempDate, setTempDate] = useState<[Moment | null, Moment | null]>([startDate ?? null, endDate ?? null]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (startDate || endDate) {
      const updated: [Moment | null, Moment | null] = [startDate ?? null, endDate ?? null];
      setValue(updated);
      setTempDate(updated);
    }
  }, [startDate, endDate]);

  const handleAccept = (acceptedDate: [Moment | null, Moment | null]) => {
    setValue(acceptedDate);
    setTempDate(acceptedDate);
    setIsOpen(false);
    onChange?.(acceptedDate);
  };

  const handleClose = () => {
    setIsOpen(false);
    setTempDate(value); // Revert changes
  };

  const handleClear = () => {
    const cleared: [Moment | null, Moment | null] = [null, null];
    setValue(cleared);
    setTempDate(cleared);
    onClear?.();
  };

  return (
    <LocalizationProvider dateAdapter={AdapterMoment}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton onClick={() => setIsOpen(true)} size="small">
          <CalendarTodayIcon fontSize="small" />
        </IconButton>

        <DateRangePicker
          open={isOpen}
          onOpen={() => setIsOpen(true)}
          onClose={handleClose}
          value={tempDate}
          onChange={(newValue) => setTempDate(newValue)}
          onAccept={handleAccept}
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
    </LocalizationProvider>
  );
};
