// widget.js
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

const DEFAULT_TITLE = 'Deadline';
const LOADING_TEXT = '...';
const TIMER_INTERVAL = 1; // second

const CountdownWidget = GObject.registerClass(
    /**
     * CountdownWidget
     * @class
     * @classdesc A widget that displays countdown to a target date/time
     */
    class CountdownWidget extends St.Bin {
        constructor(config) {
            super({
                style_class: 'countdown-widget-container',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                // Avoid vertical "breathing" on each tick; timer updates don't require it.
                y_expand: false,
            });

            this._config = config || {};
            this._title = this._config.title || DEFAULT_TITLE;
            this._targetTimestamp = this._config.targetTimestamp || 0; // Unix timestamp in seconds
            this._isRecurring = this._config.isRecurring || false;
            this._recurrenceType = this._config.recurrenceType || 'daily';
            this._recurrenceInterval = this._config.recurrenceInterval || 1;
            this._weeklyDay = this._config.weeklyDay || 0; // 0 = Monday
            this._monthlyDay = this._config.monthlyDay || 1;

            // Create label
            this._label = new St.Label({
                style_class: 'countdown-widget-label',
                text: LOADING_TEXT,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: false,
            });
            
            // Keep monospace via CSS; avoid hardcoded size (can cause clipping per instance).
            this._label.clutter_text.set_use_markup(false);
            // Prevent potential text truncation/overflow rendering artifacts.
            this._label.clutter_text.ellipsize = 0;
            
            this.set_child(this._label);

            this._lastUnitsKey = null;
            this._updateDisplay();
            this._startTimer();
        }

        /**
         * Start the update timer
         * @private
         */
        _startTimer() {
            if (this._timeoutId) {
                GLib.source_remove(this._timeoutId);
            }
            this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TIMER_INTERVAL, () => {
                this._updateDisplay();
                return GLib.SOURCE_CONTINUE;
            });
        }

        /**
         * Update the label text with remaining time
         * @private
         */
        _updateDisplay() {
            let now = Math.floor(Date.now() / 1000);
            let target = this._getNextTarget();
            let remainingSeconds = Math.max(0, target - now);
            
            const { fullText, unitsKey } = this._formatRemainingTimeDetailed(remainingSeconds);
            
            // Update via property to match other plugins (e.g. datetime)
            const shouldRelayout =
                this._lastUnitsKey === null // first render
                || unitsKey !== this._lastUnitsKey; // units part changed (e.g. days->0, months appear, etc.)

            this._label.text = `${this._title}: ${fullText}`;
            if (shouldRelayout) {
                this._label.queue_relayout();
                this.queue_relayout();
                this._lastUnitsKey = unitsKey;
            }
        }

        /**
         * Format remaining seconds into a human-readable string.
         * Additionally returns a "units key" that changes only when the units part width can change.
         * @private
         * @param {number} totalSeconds
         * @returns {{fullText: string, unitsKey: string}}
         */
        _formatRemainingTimeDetailed(totalSeconds) {
            if (totalSeconds <= 0) {
                return { fullText: '00:00:00', unitsKey: 'zero' };
            }
            
            // Calculate time components
            const secondsInMinute = 60;
            const secondsInHour = 3600;
            const secondsInDay = 86400;
            const secondsInMonth = 2592000; // 30 days approximation
            const secondsInYear = 31536000; // 365 days
            
            const years = Math.floor(totalSeconds / secondsInYear);
            let remaining = totalSeconds % secondsInYear;
            
            const months = Math.floor(remaining / secondsInMonth);
            remaining = remaining % secondsInMonth;
            
            const days = Math.floor(remaining / secondsInDay);
            remaining = remaining % secondsInDay;
            
            const hours = Math.floor(remaining / secondsInHour);
            remaining = remaining % secondsInHour;
            
            const minutes = Math.floor(remaining / secondsInMinute);
            const seconds = remaining % secondsInMinute;
            
            // Build string based on magnitude
            const parts = [];
            
            if (years > 0) {
                parts.push(`${years}y`);
            }
            if (months > 0) {
                parts.push(`${months}mo`);
            }
            if (days > 0) {
                parts.push(`${days}d`);
            }
            
            // Always show time part (HH:MM:SS)
            const timePart = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            
            const unitsKey = parts.join(' '); // width changes only when this changes
            const fullText = parts.length > 0 ? `${unitsKey} ${timePart}` : timePart;
            return { fullText, unitsKey };
        }

        /**
         * Get the next target timestamp considering recurrence
         * @private
         * @returns {number} Target timestamp in seconds
         */
        _getNextTarget() {
            if (!this._isRecurring || this._targetTimestamp === 0) {
                return this._targetTimestamp;
            }

            let now = Math.floor(Date.now() / 1000);
            let target = this._targetTimestamp;

            switch (this._recurrenceType) {
                case 'daily':
                    // Get time of day from original target
                    let targetDate = new Date(target * 1000);
                    
                    // Create today's timestamp with same time
                    let today = new Date();
                    let todayTarget = new Date(
                        today.getFullYear(),
                        today.getMonth(),
                        today.getDate(),
                        targetDate.getHours(),
                        targetDate.getMinutes(),
                        targetDate.getSeconds()
                    );
                    let todayTargetSec = Math.floor(todayTarget.getTime() / 1000);
                    
                    return todayTargetSec > now ? todayTargetSec : todayTargetSec + 86400;
                
                    
                case 'weekly':
                    // Get time from target, day from config
                    let targetTime = new Date(target * 1000);
                    let targetHours = targetTime.getHours();
                    let targetMinutes = targetTime.getMinutes();
                    let targetSeconds = targetTime.getSeconds();
                    
                    let nowDate = new Date(now * 1000);
                    let currentDayOfWeek = nowDate.getDay(); // 0 = Sunday
                    // Convert to Monday=0...Sunday=6
                    let currentDay = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;
                    
                    let daysToAdd = (this._weeklyDay - currentDay + 7) % 7;
                    if (daysToAdd === 0) {
                        // Today, check if time already passed
                        let todayTarget = new Date(
                            nowDate.getFullYear(),
                            nowDate.getMonth(),
                            nowDate.getDate(),
                            targetHours,
                            targetMinutes,
                            targetSeconds
                        );
                        if (Math.floor(todayTarget.getTime() / 1000) > now) {
                            return Math.floor(todayTarget.getTime() / 1000);
                        }
                        daysToAdd = 7; // Next week
                    }
                    
                    let nextDate = new Date(
                        nowDate.getFullYear(),
                        nowDate.getMonth(),
                        nowDate.getDate() + daysToAdd,
                        targetHours,
                        targetMinutes,
                        targetSeconds
                    );
                    return Math.floor(nextDate.getTime() / 1000);
                    
                case 'monthly':
                    // Get time from target, day from config
                    let timeFromTarget = new Date(target * 1000);
                    let tHours = timeFromTarget.getHours();
                    let tMinutes = timeFromTarget.getMinutes();
                    let tSeconds = timeFromTarget.getSeconds();
                    
                    let nowDate2 = new Date(now * 1000);
                    
                    // Try current month
                    let candidate = new Date(
                        nowDate2.getFullYear(),
                        nowDate2.getMonth(),
                        this._monthlyDay,
                        tHours,
                        tMinutes,
                        tSeconds
                    );
                    
                    let candidateSec = Math.floor(candidate.getTime() / 1000);
                    if (candidateSec > now) {
                        return candidateSec;
                    }
                    
                    // Next month
                    let nextMonth = new Date(
                        nowDate2.getFullYear(),
                        nowDate2.getMonth() + 1,
                        this._monthlyDay,
                        tHours,
                        tMinutes,
                        tSeconds
                    );
                    return Math.floor(nextMonth.getTime() / 1000);
                    
                case 'custom':
                    while (target <= now) {
                        target += this._recurrenceInterval * 86400;
                    }
                    return target;
                    
                default:
                    return target;
            }
        }

        /**
         * Update widget configuration (called when settings change)
         * @param {Object} newConfig - New configuration object
         */
        updateConfig(newConfig) {
            this._config = newConfig;
            this._title = newConfig.title || DEFAULT_TITLE;
            this._targetTimestamp = newConfig.targetTimestamp || 0;
            this._isRecurring = newConfig.isRecurring || false;
            this._recurrenceType = newConfig.recurrenceType || 'daily';
            this._recurrenceInterval = newConfig.recurrenceInterval || 1;
            this._weeklyDay = newConfig.weeklyDay || 0;
            this._monthlyDay = newConfig.monthlyDay || 1;
            this._updateDisplay();
            this.queue_relayout();
            // Timer continues automatically
        }

        destroy() {
            if (this._timeoutId) {
                GLib.source_remove(this._timeoutId);
                this._timeoutId = null;
            }
            super.destroy();
        }
    }
);

/**
 * @typedef {Object} CountdownWidgetConfig
 * @property {string} [title] - Timer title
 * @property {number} [targetTimestamp] - Target Unix timestamp (seconds)
 * @property {boolean} [isRecurring] - Whether timer repeats
 * @property {string} [recurrenceType] - daily, weekly, monthly, custom
 * @property {number} [recurrenceInterval] - Interval for custom recurrence (days)
 * @property {number} [weeklyDay] - Day of week (0=Monday, 6=Sunday)
 * @property {number} [monthlyDay] - Day of month (1-31)
 */
export default {
    createWidget: (config) => {
        return new CountdownWidget(config);
    },
};