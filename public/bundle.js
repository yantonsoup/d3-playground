(function () {
  'use strict';

  /**
   * Copyright 2016 Google Inc. All Rights Reserved.
   *
   * Licensed under the W3C SOFTWARE AND DOCUMENT NOTICE AND LICENSE.
   *
   *  https://www.w3.org/Consortium/Legal/2015/copyright-software-and-document
   *
   */

  (function(window, document) {


  // Exits early if all IntersectionObserver and IntersectionObserverEntry
  // features are natively supported.
  if ('IntersectionObserver' in window &&
      'IntersectionObserverEntry' in window &&
      'intersectionRatio' in window.IntersectionObserverEntry.prototype) {

    // Minimal polyfill for Edge 15's lack of `isIntersecting`
    // See: https://github.com/w3c/IntersectionObserver/issues/211
    if (!('isIntersecting' in window.IntersectionObserverEntry.prototype)) {
      Object.defineProperty(window.IntersectionObserverEntry.prototype,
        'isIntersecting', {
        get: function () {
          return this.intersectionRatio > 0;
        }
      });
    }
    return;
  }


  /**
   * Creates the global IntersectionObserverEntry constructor.
   * https://w3c.github.io/IntersectionObserver/#intersection-observer-entry
   * @param {Object} entry A dictionary of instance properties.
   * @constructor
   */
  function IntersectionObserverEntry(entry) {
    this.time = entry.time;
    this.target = entry.target;
    this.rootBounds = entry.rootBounds;
    this.boundingClientRect = entry.boundingClientRect;
    this.intersectionRect = entry.intersectionRect || getEmptyRect();
    this.isIntersecting = !!entry.intersectionRect;

    // Calculates the intersection ratio.
    var targetRect = this.boundingClientRect;
    var targetArea = targetRect.width * targetRect.height;
    var intersectionRect = this.intersectionRect;
    var intersectionArea = intersectionRect.width * intersectionRect.height;

    // Sets intersection ratio.
    if (targetArea) {
      // Round the intersection ratio to avoid floating point math issues:
      // https://github.com/w3c/IntersectionObserver/issues/324
      this.intersectionRatio = Number((intersectionArea / targetArea).toFixed(4));
    } else {
      // If area is zero and is intersecting, sets to 1, otherwise to 0
      this.intersectionRatio = this.isIntersecting ? 1 : 0;
    }
  }


  /**
   * Creates the global IntersectionObserver constructor.
   * https://w3c.github.io/IntersectionObserver/#intersection-observer-interface
   * @param {Function} callback The function to be invoked after intersection
   *     changes have queued. The function is not invoked if the queue has
   *     been emptied by calling the `takeRecords` method.
   * @param {Object=} opt_options Optional configuration options.
   * @constructor
   */
  function IntersectionObserver(callback, opt_options) {

    var options = opt_options || {};

    if (typeof callback != 'function') {
      throw new Error('callback must be a function');
    }

    if (options.root && options.root.nodeType != 1) {
      throw new Error('root must be an Element');
    }

    // Binds and throttles `this._checkForIntersections`.
    this._checkForIntersections = throttle(
        this._checkForIntersections.bind(this), this.THROTTLE_TIMEOUT);

    // Private properties.
    this._callback = callback;
    this._observationTargets = [];
    this._queuedEntries = [];
    this._rootMarginValues = this._parseRootMargin(options.rootMargin);

    // Public properties.
    this.thresholds = this._initThresholds(options.threshold);
    this.root = options.root || null;
    this.rootMargin = this._rootMarginValues.map(function(margin) {
      return margin.value + margin.unit;
    }).join(' ');
  }


  /**
   * The minimum interval within which the document will be checked for
   * intersection changes.
   */
  IntersectionObserver.prototype.THROTTLE_TIMEOUT = 100;


  /**
   * The frequency in which the polyfill polls for intersection changes.
   * this can be updated on a per instance basis and must be set prior to
   * calling `observe` on the first target.
   */
  IntersectionObserver.prototype.POLL_INTERVAL = null;

  /**
   * Use a mutation observer on the root element
   * to detect intersection changes.
   */
  IntersectionObserver.prototype.USE_MUTATION_OBSERVER = true;


  /**
   * Starts observing a target element for intersection changes based on
   * the thresholds values.
   * @param {Element} target The DOM element to observe.
   */
  IntersectionObserver.prototype.observe = function(target) {
    var isTargetAlreadyObserved = this._observationTargets.some(function(item) {
      return item.element == target;
    });

    if (isTargetAlreadyObserved) {
      return;
    }

    if (!(target && target.nodeType == 1)) {
      throw new Error('target must be an Element');
    }

    this._registerInstance();
    this._observationTargets.push({element: target, entry: null});
    this._monitorIntersections();
    this._checkForIntersections();
  };


  /**
   * Stops observing a target element for intersection changes.
   * @param {Element} target The DOM element to observe.
   */
  IntersectionObserver.prototype.unobserve = function(target) {
    this._observationTargets =
        this._observationTargets.filter(function(item) {

      return item.element != target;
    });
    if (!this._observationTargets.length) {
      this._unmonitorIntersections();
      this._unregisterInstance();
    }
  };


  /**
   * Stops observing all target elements for intersection changes.
   */
  IntersectionObserver.prototype.disconnect = function() {
    this._observationTargets = [];
    this._unmonitorIntersections();
    this._unregisterInstance();
  };


  /**
   * Returns any queue entries that have not yet been reported to the
   * callback and clears the queue. This can be used in conjunction with the
   * callback to obtain the absolute most up-to-date intersection information.
   * @return {Array} The currently queued entries.
   */
  IntersectionObserver.prototype.takeRecords = function() {
    var records = this._queuedEntries.slice();
    this._queuedEntries = [];
    return records;
  };


  /**
   * Accepts the threshold value from the user configuration object and
   * returns a sorted array of unique threshold values. If a value is not
   * between 0 and 1 and error is thrown.
   * @private
   * @param {Array|number=} opt_threshold An optional threshold value or
   *     a list of threshold values, defaulting to [0].
   * @return {Array} A sorted list of unique and valid threshold values.
   */
  IntersectionObserver.prototype._initThresholds = function(opt_threshold) {
    var threshold = opt_threshold || [0];
    if (!Array.isArray(threshold)) threshold = [threshold];

    return threshold.sort().filter(function(t, i, a) {
      if (typeof t != 'number' || isNaN(t) || t < 0 || t > 1) {
        throw new Error('threshold must be a number between 0 and 1 inclusively');
      }
      return t !== a[i - 1];
    });
  };


  /**
   * Accepts the rootMargin value from the user configuration object
   * and returns an array of the four margin values as an object containing
   * the value and unit properties. If any of the values are not properly
   * formatted or use a unit other than px or %, and error is thrown.
   * @private
   * @param {string=} opt_rootMargin An optional rootMargin value,
   *     defaulting to '0px'.
   * @return {Array<Object>} An array of margin objects with the keys
   *     value and unit.
   */
  IntersectionObserver.prototype._parseRootMargin = function(opt_rootMargin) {
    var marginString = opt_rootMargin || '0px';
    var margins = marginString.split(/\s+/).map(function(margin) {
      var parts = /^(-?\d*\.?\d+)(px|%)$/.exec(margin);
      if (!parts) {
        throw new Error('rootMargin must be specified in pixels or percent');
      }
      return {value: parseFloat(parts[1]), unit: parts[2]};
    });

    // Handles shorthand.
    margins[1] = margins[1] || margins[0];
    margins[2] = margins[2] || margins[0];
    margins[3] = margins[3] || margins[1];

    return margins;
  };


  /**
   * Starts polling for intersection changes if the polling is not already
   * happening, and if the page's visibility state is visible.
   * @private
   */
  IntersectionObserver.prototype._monitorIntersections = function() {
    if (!this._monitoringIntersections) {
      this._monitoringIntersections = true;

      // If a poll interval is set, use polling instead of listening to
      // resize and scroll events or DOM mutations.
      if (this.POLL_INTERVAL) {
        this._monitoringInterval = setInterval(
            this._checkForIntersections, this.POLL_INTERVAL);
      }
      else {
        addEvent(window, 'resize', this._checkForIntersections, true);
        addEvent(document, 'scroll', this._checkForIntersections, true);

        if (this.USE_MUTATION_OBSERVER && 'MutationObserver' in window) {
          this._domObserver = new MutationObserver(this._checkForIntersections);
          this._domObserver.observe(document, {
            attributes: true,
            childList: true,
            characterData: true,
            subtree: true
          });
        }
      }
    }
  };


  /**
   * Stops polling for intersection changes.
   * @private
   */
  IntersectionObserver.prototype._unmonitorIntersections = function() {
    if (this._monitoringIntersections) {
      this._monitoringIntersections = false;

      clearInterval(this._monitoringInterval);
      this._monitoringInterval = null;

      removeEvent(window, 'resize', this._checkForIntersections, true);
      removeEvent(document, 'scroll', this._checkForIntersections, true);

      if (this._domObserver) {
        this._domObserver.disconnect();
        this._domObserver = null;
      }
    }
  };


  /**
   * Scans each observation target for intersection changes and adds them
   * to the internal entries queue. If new entries are found, it
   * schedules the callback to be invoked.
   * @private
   */
  IntersectionObserver.prototype._checkForIntersections = function() {
    var rootIsInDom = this._rootIsInDom();
    var rootRect = rootIsInDom ? this._getRootRect() : getEmptyRect();

    this._observationTargets.forEach(function(item) {
      var target = item.element;
      var targetRect = getBoundingClientRect(target);
      var rootContainsTarget = this._rootContainsTarget(target);
      var oldEntry = item.entry;
      var intersectionRect = rootIsInDom && rootContainsTarget &&
          this._computeTargetAndRootIntersection(target, rootRect);

      var newEntry = item.entry = new IntersectionObserverEntry({
        time: now(),
        target: target,
        boundingClientRect: targetRect,
        rootBounds: rootRect,
        intersectionRect: intersectionRect
      });

      if (!oldEntry) {
        this._queuedEntries.push(newEntry);
      } else if (rootIsInDom && rootContainsTarget) {
        // If the new entry intersection ratio has crossed any of the
        // thresholds, add a new entry.
        if (this._hasCrossedThreshold(oldEntry, newEntry)) {
          this._queuedEntries.push(newEntry);
        }
      } else {
        // If the root is not in the DOM or target is not contained within
        // root but the previous entry for this target had an intersection,
        // add a new record indicating removal.
        if (oldEntry && oldEntry.isIntersecting) {
          this._queuedEntries.push(newEntry);
        }
      }
    }, this);

    if (this._queuedEntries.length) {
      this._callback(this.takeRecords(), this);
    }
  };


  /**
   * Accepts a target and root rect computes the intersection between then
   * following the algorithm in the spec.
   * TODO(philipwalton): at this time clip-path is not considered.
   * https://w3c.github.io/IntersectionObserver/#calculate-intersection-rect-algo
   * @param {Element} target The target DOM element
   * @param {Object} rootRect The bounding rect of the root after being
   *     expanded by the rootMargin value.
   * @return {?Object} The final intersection rect object or undefined if no
   *     intersection is found.
   * @private
   */
  IntersectionObserver.prototype._computeTargetAndRootIntersection =
      function(target, rootRect) {

    // If the element isn't displayed, an intersection can't happen.
    if (window.getComputedStyle(target).display == 'none') return;

    var targetRect = getBoundingClientRect(target);
    var intersectionRect = targetRect;
    var parent = getParentNode(target);
    var atRoot = false;

    while (!atRoot) {
      var parentRect = null;
      var parentComputedStyle = parent.nodeType == 1 ?
          window.getComputedStyle(parent) : {};

      // If the parent isn't displayed, an intersection can't happen.
      if (parentComputedStyle.display == 'none') return;

      if (parent == this.root || parent == document) {
        atRoot = true;
        parentRect = rootRect;
      } else {
        // If the element has a non-visible overflow, and it's not the <body>
        // or <html> element, update the intersection rect.
        // Note: <body> and <html> cannot be clipped to a rect that's not also
        // the document rect, so no need to compute a new intersection.
        if (parent != document.body &&
            parent != document.documentElement &&
            parentComputedStyle.overflow != 'visible') {
          parentRect = getBoundingClientRect(parent);
        }
      }

      // If either of the above conditionals set a new parentRect,
      // calculate new intersection data.
      if (parentRect) {
        intersectionRect = computeRectIntersection(parentRect, intersectionRect);

        if (!intersectionRect) break;
      }
      parent = getParentNode(parent);
    }
    return intersectionRect;
  };


  /**
   * Returns the root rect after being expanded by the rootMargin value.
   * @return {Object} The expanded root rect.
   * @private
   */
  IntersectionObserver.prototype._getRootRect = function() {
    var rootRect;
    if (this.root) {
      rootRect = getBoundingClientRect(this.root);
    } else {
      // Use <html>/<body> instead of window since scroll bars affect size.
      var html = document.documentElement;
      var body = document.body;
      rootRect = {
        top: 0,
        left: 0,
        right: html.clientWidth || body.clientWidth,
        width: html.clientWidth || body.clientWidth,
        bottom: html.clientHeight || body.clientHeight,
        height: html.clientHeight || body.clientHeight
      };
    }
    return this._expandRectByRootMargin(rootRect);
  };


  /**
   * Accepts a rect and expands it by the rootMargin value.
   * @param {Object} rect The rect object to expand.
   * @return {Object} The expanded rect.
   * @private
   */
  IntersectionObserver.prototype._expandRectByRootMargin = function(rect) {
    var margins = this._rootMarginValues.map(function(margin, i) {
      return margin.unit == 'px' ? margin.value :
          margin.value * (i % 2 ? rect.width : rect.height) / 100;
    });
    var newRect = {
      top: rect.top - margins[0],
      right: rect.right + margins[1],
      bottom: rect.bottom + margins[2],
      left: rect.left - margins[3]
    };
    newRect.width = newRect.right - newRect.left;
    newRect.height = newRect.bottom - newRect.top;

    return newRect;
  };


  /**
   * Accepts an old and new entry and returns true if at least one of the
   * threshold values has been crossed.
   * @param {?IntersectionObserverEntry} oldEntry The previous entry for a
   *    particular target element or null if no previous entry exists.
   * @param {IntersectionObserverEntry} newEntry The current entry for a
   *    particular target element.
   * @return {boolean} Returns true if a any threshold has been crossed.
   * @private
   */
  IntersectionObserver.prototype._hasCrossedThreshold =
      function(oldEntry, newEntry) {

    // To make comparing easier, an entry that has a ratio of 0
    // but does not actually intersect is given a value of -1
    var oldRatio = oldEntry && oldEntry.isIntersecting ?
        oldEntry.intersectionRatio || 0 : -1;
    var newRatio = newEntry.isIntersecting ?
        newEntry.intersectionRatio || 0 : -1;

    // Ignore unchanged ratios
    if (oldRatio === newRatio) return;

    for (var i = 0; i < this.thresholds.length; i++) {
      var threshold = this.thresholds[i];

      // Return true if an entry matches a threshold or if the new ratio
      // and the old ratio are on the opposite sides of a threshold.
      if (threshold == oldRatio || threshold == newRatio ||
          threshold < oldRatio !== threshold < newRatio) {
        return true;
      }
    }
  };


  /**
   * Returns whether or not the root element is an element and is in the DOM.
   * @return {boolean} True if the root element is an element and is in the DOM.
   * @private
   */
  IntersectionObserver.prototype._rootIsInDom = function() {
    return !this.root || containsDeep(document, this.root);
  };


  /**
   * Returns whether or not the target element is a child of root.
   * @param {Element} target The target element to check.
   * @return {boolean} True if the target element is a child of root.
   * @private
   */
  IntersectionObserver.prototype._rootContainsTarget = function(target) {
    return containsDeep(this.root || document, target);
  };


  /**
   * Adds the instance to the global IntersectionObserver registry if it isn't
   * already present.
   * @private
   */
  IntersectionObserver.prototype._registerInstance = function() {
  };


  /**
   * Removes the instance from the global IntersectionObserver registry.
   * @private
   */
  IntersectionObserver.prototype._unregisterInstance = function() {
  };


  /**
   * Returns the result of the performance.now() method or null in browsers
   * that don't support the API.
   * @return {number} The elapsed time since the page was requested.
   */
  function now() {
    return window.performance && performance.now && performance.now();
  }


  /**
   * Throttles a function and delays its execution, so it's only called at most
   * once within a given time period.
   * @param {Function} fn The function to throttle.
   * @param {number} timeout The amount of time that must pass before the
   *     function can be called again.
   * @return {Function} The throttled function.
   */
  function throttle(fn, timeout) {
    var timer = null;
    return function () {
      if (!timer) {
        timer = setTimeout(function() {
          fn();
          timer = null;
        }, timeout);
      }
    };
  }


  /**
   * Adds an event handler to a DOM node ensuring cross-browser compatibility.
   * @param {Node} node The DOM node to add the event handler to.
   * @param {string} event The event name.
   * @param {Function} fn The event handler to add.
   * @param {boolean} opt_useCapture Optionally adds the even to the capture
   *     phase. Note: this only works in modern browsers.
   */
  function addEvent(node, event, fn, opt_useCapture) {
    if (typeof node.addEventListener == 'function') {
      node.addEventListener(event, fn, opt_useCapture || false);
    }
    else if (typeof node.attachEvent == 'function') {
      node.attachEvent('on' + event, fn);
    }
  }


  /**
   * Removes a previously added event handler from a DOM node.
   * @param {Node} node The DOM node to remove the event handler from.
   * @param {string} event The event name.
   * @param {Function} fn The event handler to remove.
   * @param {boolean} opt_useCapture If the event handler was added with this
   *     flag set to true, it should be set to true here in order to remove it.
   */
  function removeEvent(node, event, fn, opt_useCapture) {
    if (typeof node.removeEventListener == 'function') {
      node.removeEventListener(event, fn, opt_useCapture || false);
    }
    else if (typeof node.detatchEvent == 'function') {
      node.detatchEvent('on' + event, fn);
    }
  }


  /**
   * Returns the intersection between two rect objects.
   * @param {Object} rect1 The first rect.
   * @param {Object} rect2 The second rect.
   * @return {?Object} The intersection rect or undefined if no intersection
   *     is found.
   */
  function computeRectIntersection(rect1, rect2) {
    var top = Math.max(rect1.top, rect2.top);
    var bottom = Math.min(rect1.bottom, rect2.bottom);
    var left = Math.max(rect1.left, rect2.left);
    var right = Math.min(rect1.right, rect2.right);
    var width = right - left;
    var height = bottom - top;

    return (width >= 0 && height >= 0) && {
      top: top,
      bottom: bottom,
      left: left,
      right: right,
      width: width,
      height: height
    };
  }


  /**
   * Shims the native getBoundingClientRect for compatibility with older IE.
   * @param {Element} el The element whose bounding rect to get.
   * @return {Object} The (possibly shimmed) rect of the element.
   */
  function getBoundingClientRect(el) {
    var rect;

    try {
      rect = el.getBoundingClientRect();
    } catch (err) {
      // Ignore Windows 7 IE11 "Unspecified error"
      // https://github.com/w3c/IntersectionObserver/pull/205
    }

    if (!rect) return getEmptyRect();

    // Older IE
    if (!(rect.width && rect.height)) {
      rect = {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top
      };
    }
    return rect;
  }


  /**
   * Returns an empty rect object. An empty rect is returned when an element
   * is not in the DOM.
   * @return {Object} The empty rect.
   */
  function getEmptyRect() {
    return {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0
    };
  }

  /**
   * Checks to see if a parent element contains a child element (including inside
   * shadow DOM).
   * @param {Node} parent The parent element.
   * @param {Node} child The child element.
   * @return {boolean} True if the parent node contains the child node.
   */
  function containsDeep(parent, child) {
    var node = child;
    while (node) {
      if (node == parent) return true;

      node = getParentNode(node);
    }
    return false;
  }


  /**
   * Gets the parent node of an element or its host element if the parent node
   * is a shadow root.
   * @param {Node} node The node whose parent to get.
   * @return {Node|null} The parent node or null if no parent exists.
   */
  function getParentNode(node) {
    var parent = node.parentNode;

    if (parent && parent.nodeType == 11 && parent.host) {
      // If the parent is a shadow root, return the host element.
      return parent.host;
    }
    return parent;
  }


  // Exposes the constructors globally.
  window.IntersectionObserver = IntersectionObserver;
  window.IntersectionObserverEntry = IntersectionObserverEntry;

  }(window, document));

  // DOM helper functions

  // private
  function selectionToArray(selection) {
    const len = selection.length;
    const result = [];
    for (let i = 0; i < len; i += 1) {
      result.push(selection[i]);
    }
    return result;
  }

  // public
  function select(selector) {
    if (selector instanceof Element) return selector;
    else if (typeof selector === 'string')
      return document.querySelector(selector);
    return null;
  }

  function selectAll(selector, parent = document) {
    if (typeof selector === 'string') {
      return selectionToArray(parent.querySelectorAll(selector));
    } else if (selector instanceof Element) {
      return selectionToArray([selector]);
    } else if (selector instanceof NodeList) {
      return selectionToArray(selector);
    } else if (selector instanceof Array) {
      return selector;
    }
    return [];
  }

  function getStepId({ id, i }) {
    return `scrollama__debug-step--${id}-${i}`;
  }

  function getOffsetId({ id }) {
    return `scrollama__debug-offset--${id}`;
  }

  // SETUP

  function setupOffset({ id, offsetVal, stepClass }) {
    const el = document.createElement('div');
    el.setAttribute('id', getOffsetId({ id }));
    el.setAttribute('class', 'scrollama__debug-offset');

    el.style.position = 'fixed';
    el.style.left = '0';
    el.style.width = '100%';
    el.style.height = '0px';
    el.style.borderTop = '2px dashed black';
    el.style.zIndex = '9999';

    const text = document.createElement('p');
    text.innerText = `".${stepClass}" trigger: ${offsetVal}`;
    text.style.fontSize = '12px';
    text.style.fontFamily = 'monospace';
    text.style.color = 'black';
    text.style.margin = '0';
    text.style.padding = '6px';
    el.appendChild(text);
    document.body.appendChild(el);
  }

  function setup({ id, offsetVal, stepEl }) {
    const stepClass = stepEl[0].getAttribute('class');
    setupOffset({ id, offsetVal, stepClass });
  }

  // UPDATE
  function updateOffset({ id, offsetMargin, offsetVal }) {
    const idVal = getOffsetId({ id });
    const el = document.querySelector(`#${idVal}`);
    el.style.top = `${offsetMargin}px`;
  }

  function update({ id, stepOffsetHeight, offsetMargin, offsetVal }) {
    updateOffset({ id, offsetMargin });
  }

  function notifyStep({ id, index, state }) {
    const idVal = getStepId({ id, i: index });
    const elA = document.querySelector(`#${idVal}_above`);
    const elB = document.querySelector(`#${idVal}_below`);
    const display = state === 'enter' ? 'block' : 'none';

    if (elA) elA.style.display = display;
    if (elB) elB.style.display = display;
  }

  function scrollama() {
    const ZERO_MOE = 1; // zero with some rounding margin of error
    const callback = {};
    const io = {};

    let containerEl = null;
    let graphicEl = null;
    let stepEl = null;

    let id = null;
    let offsetVal = 0;
    let offsetMargin = 0;
    let vh = 0;
    let ph = 0;
    let stepOffsetHeight = null;
    let stepOffsetTop = null;
    let bboxGraphic = null;

    let isReady = false;
    let isEnabled = false;
    let debugMode = false;
    let progressMode = false;
    let progressThreshold = 0;
    let preserveOrder = false;
    let triggerOnce = false;

    let stepStates = null;
    let containerState = null;
    let previousYOffset = -1;
    let direction = null;

    const exclude = [];

    // HELPERS
    function generateId() {
      const a = 'abcdefghijklmnopqrstuv';
      const l = a.length;
      const t = new Date().getTime();
      const r = [0, 0, 0].map(d => a[Math.floor(Math.random() * l)]).join('');
      return `${r}${t}`;
    }

    //www.gomakethings.com/how-to-get-an-elements-distance-from-the-top-of-the-page-with-vanilla-javascript/
    function getOffsetTop(el) {
      // Set our distance placeholder
      let distance = 0;

      // Loop up the DOM
      if (el.offsetParent) {
        do {
          distance += el.offsetTop;
          el = el.offsetParent;
        } while (el);
      }

      // Return our distance
      return distance < 0 ? 0 : distance;
    }

    function getPageHeight() {
      const body = document.body;
      const html = document.documentElement;

      return Math.max(
        body.scrollHeight,
        body.offsetHeight,
        html.clientHeight,
        html.scrollHeight,
        html.offsetHeight
      );
    }

    function getIndex(element) {
      return +element.getAttribute('data-scrollama-index');
    }

    function updateDirection() {
      if (window.pageYOffset > previousYOffset) direction = 'down';
      else if (window.pageYOffset < previousYOffset) direction = 'up';
      previousYOffset = window.pageYOffset;
    }

    function handleResize() {
      vh = window.innerHeight;
      ph = getPageHeight();

      bboxGraphic = graphicEl ? graphicEl.getBoundingClientRect() : null;

      offsetMargin = offsetVal * vh;

      stepOffsetHeight = stepEl ? stepEl.map(el => el.offsetHeight) : [];

      stepOffsetTop = stepEl ? stepEl.map(getOffsetTop) : [];

      if (isEnabled && isReady) updateIO();

      if (debugMode)
        update({ id, stepOffsetHeight, offsetMargin, offsetVal });
    }

    function handleEnable(enable) {
      if (enable && !isEnabled) {
        if (isReady) updateIO();
        isEnabled = true;
      } else if (!enable) {
        if (io.top) io.top.disconnect();
        if (io.bottom) io.bottom.disconnect();
        if (io.stepAbove) io.stepAbove.forEach(d => d.disconnect());
        if (io.stepBelow) io.stepBelow.forEach(d => d.disconnect());
        if (io.stepProgress) io.stepProgress.forEach(d => d.disconnect());
        if (io.viewportAbove) io.viewportAbove.forEach(d => d.disconnect());
        if (io.viewportBelow) io.viewportBelow.forEach(d => d.disconnect());
        isEnabled = false;
      }
    }

    function createThreshold(height) {
      const count = Math.ceil(height / progressThreshold);
      const t = [];
      const ratio = 1 / count;
      for (let i = 0; i < count; i++) {
        t.push(i * ratio);
      }
      return t;
    }

    // NOTIFY CALLBACKS
    function notifyOthers(index, location) {
      if (location === 'above') {
        // check if steps above/below were skipped and should be notified first
        for (let i = 0; i < index; i++) {
          const ss = stepStates[i];
          if (ss.state === 'enter') notifyStepExit(stepEl[i], 'down');
          if (ss.direction === 'up') {
            notifyStepEnter(stepEl[i], 'down', false);
            notifyStepExit(stepEl[i], 'down');
          }
        }
      } else if (location === 'below') {
        for (let i = stepStates.length - 1; i > index; i--) {
          const ss = stepStates[i];
          if (ss.state === 'enter') {
            notifyStepExit(stepEl[i], 'up');
          }
          if (ss.direction === 'down') {
            notifyStepEnter(stepEl[i], 'up', false);
            notifyStepExit(stepEl[i], 'up');
          }
        }
      }
    }

    function notifyStepEnter(element, direction, check = true) {
      const index = getIndex(element);
      const resp = { element, index, direction };

      // store most recent trigger
      stepStates[index].direction = direction;
      stepStates[index].state = 'enter';

      if (preserveOrder && check && direction === 'down')
        notifyOthers(index, 'above');

      if (preserveOrder && check && direction === 'up')
        notifyOthers(index, 'below');

      if (
        callback.stepEnter &&
        typeof callback.stepEnter === 'function' &&
        !exclude[index]
      ) {
        callback.stepEnter(resp, stepStates);
        if (debugMode) notifyStep({ id, index, state: 'enter' });
        if (triggerOnce) exclude[index] = true;
      }

      if (progressMode) {
        if (direction === 'down') notifyStepProgress(element, 0);
        else notifyStepProgress(element, 1);
      }
    }

    function notifyStepExit(element, direction) {
      const index = getIndex(element);
      const resp = { element, index, direction };

      // store most recent trigger
      stepStates[index].direction = direction;
      stepStates[index].state = 'exit';

      if (progressMode) {
        if (direction === 'down') notifyStepProgress(element, 1);
        else notifyStepProgress(element, 0);
      }

      if (callback.stepExit && typeof callback.stepExit === 'function') {
        callback.stepExit(resp, stepStates);
        if (debugMode) notifyStep({ id, index, state: 'exit' });
      }
    }

    function notifyStepProgress(element, progress) {
      const index = getIndex(element);
      const resp = { element, index, progress };
      if (callback.stepProgress && typeof callback.stepProgress === 'function')
        callback.stepProgress(resp);
    }

    function notifyContainerEnter() {
      const resp = { direction };
      containerState.direction = direction;
      containerState.state = 'enter';
      if (
        callback.containerEnter &&
        typeof callback.containerEnter === 'function'
      )
        callback.containerEnter(resp);
    }

    function notifyContainerExit() {
      const resp = { direction };
      containerState.direction = direction;
      containerState.state = 'exit';
      if (callback.containerExit && typeof callback.containerExit === 'function')
        callback.containerExit(resp);
    }

    // OBSERVER - INTERSECT HANDLING

    // if TOP edge of step crosses threshold,
    // bottom must be > 0 which means it is on "screen" (shifted by offset)
    function intersectStepAbove(entries) {
      updateDirection();
      entries.forEach(entry => {
        const { isIntersecting, boundingClientRect, target } = entry;

        // bottom is how far bottom edge of el is from top of viewport
        const { bottom, height } = boundingClientRect;
        const bottomAdjusted = bottom - offsetMargin;
        const index = getIndex(target);
        const ss = stepStates[index];

        if (bottomAdjusted >= -ZERO_MOE) {
          if (isIntersecting && direction === 'down' && ss.state !== 'enter')
            notifyStepEnter(target, direction);
          else if (!isIntersecting && direction === 'up' && ss.state === 'enter')
            notifyStepExit(target, direction);
          else if (
            !isIntersecting &&
            bottomAdjusted >= height &&
            direction === 'down' &&
            ss.state === 'enter'
          ) {
            notifyStepExit(target, direction);
          }
        }
      });
    }

    function intersectStepBelow(entries) {
      updateDirection();
      entries.forEach(entry => {
        const { isIntersecting, boundingClientRect, target } = entry;

        const { bottom, height } = boundingClientRect;
        const bottomAdjusted = bottom - offsetMargin;
        const index = getIndex(target);
        const ss = stepStates[index];

        if (
          bottomAdjusted >= -ZERO_MOE &&
          bottomAdjusted < height &&
          isIntersecting &&
          direction === 'up' &&
          ss.state !== 'enter'
        ) {
          notifyStepEnter(target, direction);
        } else if (
          bottomAdjusted <= ZERO_MOE &&
          !isIntersecting &&
          direction === 'down' &&
          ss.state === 'enter'
        ) {
          notifyStepExit(target, direction);
        }
      });
    }

    /*
  	if there is a scroll event where a step never intersects (therefore
  	skipping an enter/exit trigger), use this fallback to detect if it is
  	in view
  	*/
    function intersectViewportAbove(entries) {
      updateDirection();
      entries.forEach(entry => {
        const { isIntersecting, target } = entry;
        const index = getIndex(target);
        const ss = stepStates[index];
        if (
          isIntersecting &&
          direction === 'down' &&
          ss.state !== 'enter' &&
          ss.direction !== 'down'
        ) {
          notifyStepEnter(target, 'down');
          notifyStepExit(target, 'down');
        }
      });
    }

    function intersectViewportBelow(entries) {
      updateDirection();
      entries.forEach(entry => {
        const { isIntersecting, target } = entry;
        const index = getIndex(target);
        const ss = stepStates[index];
        if (
          isIntersecting &&
          direction === 'up' &&
          ss.state !== 'enter' &&
          ss.direction !== 'up'
        ) {
          notifyStepEnter(target, 'up');
          notifyStepExit(target, 'up');
        }
      });
    }

    function intersectStepProgress(entries) {
      updateDirection();
      entries.forEach(
        ({ isIntersecting, intersectionRatio, boundingClientRect, target }) => {
          const { bottom } = boundingClientRect;
          const bottomAdjusted = bottom - offsetMargin;

          if (isIntersecting && bottomAdjusted >= -ZERO_MOE) {
            notifyStepProgress(target, +intersectionRatio.toFixed(3));
          }
        }
      );
    }

    function intersectTop(entries) {
      updateDirection();
      const { isIntersecting, boundingClientRect } = entries[0];
      const { top, bottom } = boundingClientRect;

      if (bottom > -ZERO_MOE) {
        if (isIntersecting) notifyContainerEnter(direction);
        else if (containerState.state === 'enter') notifyContainerExit(direction);
      }
    }

    function intersectBottom(entries) {
      updateDirection();
      const { isIntersecting, boundingClientRect } = entries[0];
      const { top } = boundingClientRect;

      if (top < ZERO_MOE) {
        if (isIntersecting) notifyContainerEnter(direction);
        else if (containerState.state === 'enter') notifyContainerExit(direction);
      }
    }

    // OBSERVER - CREATION

    function updateTopIO() {
      if (io.top) io.top.unobserve(containerEl);

      const options = {
        root: null,
        rootMargin: `${vh}px 0px -${vh}px 0px`,
        threshold: 0
      };

      io.top = new IntersectionObserver(intersectTop, options);
      io.top.observe(containerEl);
    }

    function updateBottomIO() {
      if (io.bottom) io.bottom.unobserve(containerEl);
      const options = {
        root: null,
        rootMargin: `-${bboxGraphic.height}px 0px ${bboxGraphic.height}px 0px`,
        threshold: 0
      };

      io.bottom = new IntersectionObserver(intersectBottom, options);
      io.bottom.observe(containerEl);
    }

    // top edge
    function updateStepAboveIO() {
      if (io.stepAbove) io.stepAbove.forEach(d => d.disconnect());

      io.stepAbove = stepEl.map((el, i) => {
        const marginTop = stepOffsetHeight[i];
        const marginBottom = -vh + offsetMargin;
        const rootMargin = `${marginTop}px 0px ${marginBottom}px 0px`;

        const options = {
          root: null,
          rootMargin,
          threshold: 0
        };

        const obs = new IntersectionObserver(intersectStepAbove, options);
        obs.observe(el);
        return obs;
      });
    }

    // bottom edge
    function updateStepBelowIO() {
      if (io.stepBelow) io.stepBelow.forEach(d => d.disconnect());

      io.stepBelow = stepEl.map((el, i) => {
        const marginTop = -offsetMargin;
        const marginBottom = ph - vh + stepOffsetHeight[i] + offsetMargin;
        const rootMargin = `${marginTop}px 0px ${marginBottom}px 0px`;

        const options = {
          root: null,
          rootMargin,
          threshold: 0
        };

        const obs = new IntersectionObserver(intersectStepBelow, options);
        obs.observe(el);
        return obs;
      });
    }

    // jump into viewport
    function updateViewportAboveIO() {
      if (io.viewportAbove) io.viewportAbove.forEach(d => d.disconnect());
      io.viewportAbove = stepEl.map((el, i) => {
        const marginTop = stepOffsetTop[i];
        const marginBottom = -(vh - offsetMargin + stepOffsetHeight[i]);
        const rootMargin = `${marginTop}px 0px ${marginBottom}px 0px`;
        const options = {
          root: null,
          rootMargin,
          threshold: 0
        };

        const obs = new IntersectionObserver(intersectViewportAbove, options);
        obs.observe(el);
        return obs;
      });
    }

    function updateViewportBelowIO() {
      if (io.viewportBelow) io.viewportBelow.forEach(d => d.disconnect());
      io.viewportBelow = stepEl.map((el, i) => {
        const marginTop = -(offsetMargin + stepOffsetHeight[i]);
        const marginBottom =
          ph - stepOffsetTop[i] - stepOffsetHeight[i] - offsetMargin;
        const rootMargin = `${marginTop}px 0px ${marginBottom}px 0px`;
        const options = {
          root: null,
          rootMargin,
          threshold: 0
        };

        const obs = new IntersectionObserver(intersectViewportBelow, options);
        obs.observe(el);
        return obs;
      });
    }

    // progress progress tracker
    function updateStepProgressIO() {
      if (io.stepProgress) io.stepProgress.forEach(d => d.disconnect());

      io.stepProgress = stepEl.map((el, i) => {
        const marginTop = stepOffsetHeight[i] - offsetMargin;
        const marginBottom = -vh + offsetMargin;
        const rootMargin = `${marginTop}px 0px ${marginBottom}px 0px`;

        const threshold = createThreshold(stepOffsetHeight[i]);
        const options = {
          root: null,
          rootMargin,
          threshold
        };

        const obs = new IntersectionObserver(intersectStepProgress, options);
        obs.observe(el);
        return obs;
      });
    }

    function updateIO() {
      updateViewportAboveIO();
      updateViewportBelowIO();
      updateStepAboveIO();
      updateStepBelowIO();

      if (progressMode) updateStepProgressIO();

      if (containerEl && graphicEl) {
        updateTopIO();
        updateBottomIO();
      }
    }

    // SETUP FUNCTIONS

    function indexSteps() {
      stepEl.forEach((el, i) => el.setAttribute('data-scrollama-index', i));
    }

    function setupStates() {
      stepStates = stepEl.map(() => ({
        direction: null,
        state: null
      }));

      containerState = { direction: null, state: null };
    }

    function addDebug() {
      if (debugMode) setup({ id, stepEl, offsetVal });
    }

    const S = {};

    S.setup = ({
      container,
      graphic,
      step,
      offset = 0.5,
      progress = false,
      threshold = 4,
      debug = false,
      order = true,
      once = false
    }) => {
      id = generateId();
      // elements
      stepEl = selectAll(step);
      containerEl = container ? select(container) : null;
      graphicEl = graphic ? select(graphic) : null;

      // error if no step selected
      if (!stepEl.length) {
        console.error('scrollama error: no step elements');
        return S;
      }

      // options
      debugMode = debug;
      progressMode = progress;
      preserveOrder = order;
      triggerOnce = once;

      S.offsetTrigger(offset);
      progressThreshold = Math.max(1, +threshold);

      isReady = true;

      // customize
      addDebug();
      indexSteps();
      setupStates();
      handleResize();
      handleEnable(true);
      return S;
    };

    S.resize = () => {
      handleResize();
      return S;
    };

    S.enable = () => {
      handleEnable(true);
      return S;
    };

    S.disable = () => {
      handleEnable(false);
      return S;
    };

    S.destroy = () => {
      handleEnable(false);
      Object.keys(callback).forEach(c => (callback[c] = null));
      Object.keys(io).forEach(i => (io[i] = null));
    };

    S.offsetTrigger = function(x) {
      if (x && !isNaN(x)) {
        offsetVal = Math.min(Math.max(0, x), 1);
        return S;
      }
      return offsetVal;
    };

    S.onStepEnter = cb => {
      callback.stepEnter = cb;
      return S;
    };

    S.onStepExit = cb => {
      callback.stepExit = cb;
      return S;
    };

    S.onStepProgress = cb => {
      callback.stepProgress = cb;
      return S;
    };

    S.onContainerEnter = cb => {
      callback.containerEnter = cb;
      return S;
    };

    S.onContainerExit = cb => {
      callback.containerExit = cb;
      return S;
    };

    return S;
  }

  const sovietCountryIsoCodes = ["ARM", "AZE", "BLR", "EST", "GEO", "KAZ", "KGZ", "LVA", "LTU", "MDA", "RUS", "TJK", "TKM", "UKR", "UZB"];
  const colors = ["#feedde", "#fdbe85", "#fd8d3c", "#e6550d", "#a63603", "#feedde", "#fdbe85", "#fd8d3c", "#e6550d", "#feedde", "#fdbe85", "#fd8d3c", "#e6550d", "#a63603"];
  const sovietLabelShift = {
    ARM: {
      x: -12,
      y: 2
    },
    AZE: {
      x: -8,
      y: 5
    },
    BLR: {
      x: -14,
      y: 4
    },
    EST: {
      x: -12,
      y: 0
    },
    GEO: {
      x: -13,
      y: 1
    },
    KAZ: {
      x: 14,
      y: 6
    },
    KGZ: {
      x: 5,
      y: 3
    },
    LVA: {
      x: -12,
      y: 0
    },
    LTU: {
      x: -14,
      y: 0
    },
    MDA: {
      x: -12,
      y: 1
    },
    RUS: {
      x: -40,
      y: 10
    },
    TJK: {
      x: -4,
      y: 6
    },
    TKM: {
      x: -10,
      y: 8
    },
    UKR: {
      x: -9,
      y: 7
    },
    UZB: {
      x: -12,
      y: 0
    }
  };

  function firstAnimation() {
    var scale = 2;
    const mapContainer = d3.select(".scroll__graphic");
    const boundingBox = mapContainer.node().getBoundingClientRect();
    const {
      height,
      width
    } = boundingBox;
    var translateX = -Math.floor(width * 0.7);
    var translateY = -Math.floor(height * 0.4);
    console.warn("firstAnimation translateX", translateX);
    console.warn("first animation translateY", translateY);
    console.warn({
      scale
    });
    console.warn({
      width
    });
    console.warn({
      height
    });
    console.warn({
      translateX
    });
    console.warn({
      translateY
    });
    d3.select("#map").transition().duration(1000).attr("transform", "translate(" + width / 2 + "," + height / 2 + ")scale(" + scale + ")translate(" + translateX + "," + translateY + ")"); // d3.selectAll(".soviet-country")
    //   .transition()
    //   .duration(100)
    //   .style("fill", "#a63603")
    //   .style("stroke-width", 0.5 + "px");

    d3.selectAll(".non-soviet-country").transition().duration(100).style("opacity", "0.5").style("stroke-width", 0.25 + "px");
    d3.selectAll(".soviet-country").transition().duration(1000).style("fill", function (d, i) {
      // console.warn('i', i)
      return colors[i];
    });
  }

  function secondAnimation(countries) {
    const mapContainer = d3.select(".scroll__graphic");
    const boundingBox = mapContainer.node().getBoundingClientRect();
    const {
      width,
      height
    } = boundingBox;
    var scale = 4;
    var translateX = -Math.floor(width * 0.6);
    var translateY = -Math.floor(height * 0.33);
    d3.select("#map").transition().duration(1000).attr("transform", "translate(" + width / 2 + "," + height / 2 + ")scale(" + scale + ")translate(" + translateX + "," + translateY + ")");
    d3.selectAll(".non-soviet-country").transition().duration(500).style("stroke-width", 0.175 + "px");
    d3.selectAll(".soviet-country").transition().duration(500).style("stroke-width", 0.25 + "px");
    d3.selectAll(".non-soviet-country").transition().duration(500).style("opacity", "0.1");
    d3.selectAll(".place-label").data(countries).enter().append("text").attr("class", "place-label").attr("transform", function (d) {
      // can get centroid easily like this!  path.centroid(d)
      const [x, y] = path.centroid(d);
      return `translate(${x},${y})`;
    }).attr("dx", function ({
      id
    }) {
      if (sovietCountryIsoCodes.includes(id)) {
        const {
          x
        } = sovietLabelShift[id];
        console.warn(x); // can get centroid easily like this!  path.centroid(d)

        return `${x}px`;
      }

      return;
    }).attr("dy", function (d) {
      if (sovietCountryIsoCodes.includes(d.id)) {
        const name = d.id;
        const {
          y
        } = sovietLabelShift[name]; // can get centroid easily like this!  path.centroid(d)

        return `${y}px`;
      }

      return;
    }) // .style("z-index", '100')
    .text(function (d) {
      if (sovietCountryIsoCodes.includes(d.id)) {
        console.warn("soviet datapoint", d);
        return d.properties.name;
      }

      return;
    }).style("font-size", 3 + "px");
  }

  var animations = {
    firstAnimation,
    secondAnimation
  };

  function setupScrollama(countries) {
    const scroller = scrollama(); // response = { element, direction, index }

    function handleStepEnter(response) {
      console.warn("handleStepEnter, response", {
        response
      });

      switch (response.index) {
        case 0:
          animations.firstAnimation();
          break;

        case 1:
          animations.secondAnimation(countries);
          break;

        default:
          break;
      }
    }

    function handleContainerEnter(response) {
      console.warn("Scrollama :: handleContainerEnter");
    }

    function handleContainerExit(response) {
      console.warn("Scrollama :: handleContainerExit");
    }

    scroller.setup({
      container: ".scroll",
      graphic: ".scroll__graphic",
      text: ".scroll__text",
      step: ".scroll__text .step",
      debug: false,
      offset: 0.9
    }).onStepEnter(handleStepEnter).onContainerEnter(handleContainerEnter).onContainerExit(handleContainerExit);
  } // setup resize event -> this is causing issues in mobile when the mobile headers resize
  // window.addEventListener("resize", handleResize);

  function firstPaint() {
    // Setup sizes for the graphic and steps
    var container = d3.select(".scroll");
    const boundingBox = container.node().getBoundingClientRect();
    const {
      width,
      height
    } = boundingBox;
    var text = container.select(".scroll__text");
    var textWidth = text.node().offsetWidth;
    var step = text.selectAll(".step");
    var stepHeight = Math.floor(window.innerHeight * 1);
    step.style("height", stepHeight + "px"); // var graphicMargin = 16 * 4; // 64px

    var graphicMarginTop = Math.floor(window.innerHeight * 0.25);
    var graphic = container.select(".scroll__graphic");
    console.warn('graphic width, height', graphic.node().offsetWidth);
    graphic.style("width", width + "px").style("height", width + "px").style("top", graphicMarginTop + "px"); // -----------------------------------

    console.warn({
      textWidth
    });
    console.warn('height', {
      height
    });
    console.warn('width', {
      width
    });
    d3.select(".header-container").style("height", 850 + "px");
    d3.select(".ussr-svg-container").style("width", textWidth + "px");
    d3.select(".intro-block").style("width", textWidth + "px");
    d3.select(".name-block").style("width", textWidth + "px");
    d3.select(".ussr-svg").style("height", 200 + "px");
    d3.select(".ussr-svg").style("width", 200 + "px");
  }

  function loadMap() {
    return new Promise((resolve, reject) => {
      d3.json("./json/110topoworld.json", function (json) {
        console.warn("loaded 110topoworld.json:", json);
        resolve(json);
      });
    });
  }

  var mercatorBounds = function (projection, maxlat) {
    var yaw = projection.rotate()[0],
        xymax = projection([-yaw + 180 - 1e-6, -maxlat]),
        xymin = projection([-yaw - 180 + 1e-6, maxlat]);
    return [xymin, xymax];
  };

  function paintMap(countries) {
    const mapContainer = d3.select(".scroll__graphic");
    const boundingBox = mapContainer.node().getBoundingClientRect();
    const {
      height,
      width
    } = boundingBox;
    var rotate = -20; // so that [-60, 0] becomes initial center of projection

    var maxlat = 83;
    var projection = d3.geo.mercator().rotate([rotate, 0]).scale(1) // we'll scale up to match viewport shortly.
    .translate([width / 2, height / 2]); // .center([0, 25])

    var b = mercatorBounds(projection, maxlat);
    var s = width / (b[1][0] - b[0][0]);
    var scaleExtent = [s, 10 * s];
    projection.scale(scaleExtent[0]);
    var path = d3.geo.path().projection(projection);
    const svg = d3.select(".scroll__graphic").append("svg").attr("width", width).attr("height", height);
    const map = svg.append("g").attr("id", "map");
    map.selectAll("path").data(countries).enter().append("path").attr("d", path).style("stroke-width", 0.5 + "px").attr("class", "country").attr("id", function (d, i) {
      return "country" + d.id;
    }).attr("class", function (datapoint, i) {
      if (sovietCountryIsoCodes.includes(datapoint.id)) {
        return "country soviet-country";
      } else {
        return "country non-soviet-country";
      }
    });
  }

  // logs will still point to your original source modules

  console.log('if you have sourcemaps enabled in your devtools, click on main.js:5 -->');

  window.onbeforeunload = function () {
    window.scrollTo(0, 0);
  };

  firstPaint();
  loadMap().then(json => {
    const countries = topojson.feature(json, json.objects.subunits).features;
    console.warn({
      countries
    });
    paintMap(countries);
    setupScrollama(countries);
  });

}());
//# sourceMappingURL=bundle.js.map
