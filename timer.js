import React, { useState, useEffect } from 'react';
import { IdleTimerProvider, useIdleTimer } from 'react-idle-timer';

const SessionManager = () => {
  const [isPromptVisible, setPromptVisible] = useState(false);
  const [isAuthenticated, setAuthenticated] = useState(true); // Initial state for demo purposes
  const [tokenExpiryTime, setTokenExpiryTime] = useState(Date.now() + 30 * 60 * 1000); // JWT expires in 30 mins

  // Refresh JWT if active for 25 minutes
  const refreshTokenIfActive = () => {
    const timeUntilExpiry = tokenExpiryTime - Date.now();
    if (timeUntilExpiry <= 5 * 60 * 1000) { // If less than 5 mins to expiry
      refreshToken();
    }
  };

  // Function to refresh the JWT
  const refreshToken = async () => {
    try {
      const response = await fetch('/api/refresh-token', { method: 'POST' });
      if (response.ok) {
        const data = await response.json();
        setTokenExpiryTime(Date.now() + 30 * 60 * 1000); // Reset expiry to 30 mins
        console.log('Token refreshed');
      } else {
        throw new Error('Failed to refresh token');
      }
    } catch (error) {
      console.error(error);
      logoutUser();
    }
  };

  // Log out the user
  const logoutUser = () => {
    setAuthenticated(false);
    console.log('User logged out');
    // Additional logout handling (redirect to login, cleanup, etc.)
  };

  // Handle presence change
  const handlePresenceChange = (isPresent) => {
    if (isPresent) {
      // User became active
      refreshTokenIfActive();
      setPromptVisible(false);
    } else {
      // User became idle
      setPromptVisible(true);
      setTimeout(() => {
        if (isPromptVisible) logoutUser(); // Log out if prompt is not confirmed
      }, 5 * 60 * 1000); // Wait 5 minutes for user response
    }
  };

  // Handle user response to prompt
  const handlePromptResponse = (isConfirmed) => {
    if (isConfirmed) {
      refreshToken();
    } else {
      logoutUser();
    }
    setPromptVisible(false);
  };

  return (
    <IdleTimerProvider
      timeout={25 * 60 * 1000} // Idle time set to 25 minutes
      onPresenceChange={handlePresenceChange}
      debounce={500}
    >
      <div>
        {isAuthenticated ? (
          <div>Welcome to the secure section</div>
        ) : (
          <div>You have been logged out</div>
        )}

        {/* Idle prompt */}
        {isPromptVisible && (
          <div className="idle-prompt">
            <p>Are you still there?</p>
            <button onClick={() => handlePromptResponse(true)}>Yes</button>
            <button onClick={() => handlePromptResponse(false)}>No</button>
          </div>
        )}
      </div>
    </IdleTimerProvider>
  );
};

export default SessionManager;
