import L from 'leaflet';
import ko from 'knockout';
import 'lib/leaflet.control.commons';
import layout from './control.html';
import 'lib/controls-styles/controls-styles.css';
import './style.css';
import {getDeclination} from 'lib/magnetic-declination';
import 'vendored/github.com/bbecquet/Leaflet.RotatedMarker/leaflet.rotatedMarker';
import iconPointer from './pointer.svg';
import iconPointerStart from './pointer-start.svg';
import iconPointerEnd from './pointer-end.svg';
import {ElevationProfile, calcSamplingInterval} from 'lib/leaflet.control.elevation-profile';

function radians(x) {
    return x / 180 * Math.PI;
}

function degrees(x) {
    return x / Math.PI * 180;
}

function calcAzimuth(latlng1, latlng2) {
    const lat1 = radians(latlng1.lat);
    const lat2 = radians(latlng2.lat);
    const lng1 = radians(latlng1.lng);
    const lng2 = radians(latlng2.lng);

    const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
    let brng = Math.atan2(y, x);
    brng = degrees(brng);
    return brng;
}


function calcAngle(latlng1, latlng2) {
    const p1 = L.Projection.SphericalMercator.project(latlng1);
    const p2 = L.Projection.SphericalMercator.project(latlng2);
    const delta = p2.subtract(p1);
    const angle = Math.atan2(delta.x, delta.y);
    return degrees(angle);
}

function roundAzimuth(a) {
    return (Math.round(a) + 360) % 360
}

L.Control.Azimuth = L.Control.extend({
        options: {
            position: 'bottomleft'
        },

        includes: L.Mixin.Events,

        initialize: function(options) {
            L.Control.prototype.initialize.call(this, options);
            this._enabled = ko.observable(false);
            this.trueAzimuth = ko.observable(null);
            this.magneticAzimuth = ko.observable(null);
            this.distance = ko.observable(null);
            this.points = {
                start: null,
                end: null
            };
            const iconSingle = L.icon({iconUrl: iconPointer, iconSize: [30, 30]});
            const iconStart = L.icon({iconUrl: iconPointerStart, iconSize: [40, 40]});
            const iconEnd = L.icon({iconUrl: iconPointerEnd, iconSize: [40, 40]});
            this.markers = {
                single: L.marker([0, 0], {icon: iconSingle, draggable: true, which: 'start'})
                    .on('drag', this.onMarkerDrag, this)
                    .on('click', L.DomEvent.stopPropagation),
                start: L.marker([0, 0], {icon: iconStart, draggable: true, which: 'start', rotationOrigin: 'center center'})
                    .on('drag', this.onMarkerDrag, this)
                    .on('click', L.DomEvent.stopPropagation)
                    .on('dragend', this.onMarkerDragEnd, this),
                end: L.marker([0, 0], {icon: iconEnd, draggable: true, which: 'end', rotationOrigin: 'center center'})
                    .on('drag', this.onMarkerDrag, this)
                    .on('click', L.DomEvent.stopPropagation)
                    .on('dragend', this.onMarkerDragEnd, this)
            };
            this.azimuthLine = L.polyline([], {interactive: false, weight: 1.5});
        },

        onAdd: function(map) {
            this._map = map;
            const container = this._container =
                L.DomUtil.create('div', 'leaflet-control leaflet-control-button leaflet-control-azimuth');
            this._stopContainerEvents();
            container.innerHTML = layout;
            container.title = "Measure bearing, display line of sight";
            ko.applyBindings(this, container);
            L.DomEvent.on(container, 'click', this.onClick, this);
            return container;
        },

        onClick: function() {
            this.setExpanded(true);
        },

        onMinimizeButtonClick: function(e) {
            setTimeout(() => this.setExpanded(false), 0);
        },

        onMarkerDrag: function(e) {
            const marker = e.target;
            this.setPoints({[marker.options.which]: marker.getLatLng()});
        },

        onMarkerDragEnd: function() {
            if (this.elevationControl) {
                this.showProfile();
            }
        },

        setExpanded: function(expanded) {
            if (!!expanded === this.isExpanded()) {
                return;
            }
            if (expanded) {
                L.DomUtil.addClass(this._container, 'expanded');
            } else {
                L.DomUtil.removeClass(this._container, 'expanded');
                this.hideProfile();
                this.setPoints({start: null, end: null});
            }
            this.setEnabled(expanded);
        },

        setEnabled: function(enabled) {
            if (!!enabled === this.isEnabled()) {
                return;
            }
            if (enabled) {
                L.DomUtil.addClass(this._map._container, 'azimuth-control-active');
                this._map.on('click', this.onMapClick, this);
                this.fire('enabled');
            } else {
                L.DomUtil.removeClass(this._map._container, 'azimuth-control-active');
                this._map.off('click', this.onMapClick, this);
            }
            this._map.clickLocked = enabled;
            this._enabled(!!enabled);
        },

        isEnabled: function() {
            return !!this._enabled();
        },

        onEnableButtonClick: function() {
            this.setEnabled(!this.isEnabled());
        },

        isExpanded: function() {
            return L.DomUtil.hasClass(this._container, 'expanded');
        },

        setPoints: function(points) {
            Object.assign(this.points, points);
            points = this.points;
            if (points.start && !points.end) {
                this.markers.single
                    .setLatLng(points.start)
                    .addTo(this._map);
            } else {
                this.markers.single.removeFrom(this._map);
            }
            if (points.start && points.end) {
                const angle = calcAngle(points.start, points.end);
                this.markers.start
                    .setLatLng(points.start)
                    .addTo(this._map)
                    .setRotationAngle(angle);
                this.markers.end
                    .setLatLng(points.end)
                    .addTo(this._map)
                    .setRotationAngle(angle);
                this.azimuthLine
                    .setLatLngs([[points.start, points.end]])
                    .addTo(this._map);
            } else {
                this.markers.start.removeFrom(this._map);
                this.markers.end.removeFrom(this._map);
                this.azimuthLine.removeFrom(this._map);
            }
            this.updateValuesDisplay();
        },

        updateValuesDisplay: function() {
            if (this.points.start && this.points.end) {
                const points = this.points;
                const azimuth = calcAzimuth(points.start, points.end);
                this.trueAzimuth(roundAzimuth(azimuth));
                const declination = getDeclination(points.start.lat, points.start.lng);
                if (declination !== null) {
                    this.magneticAzimuth(roundAzimuth(azimuth - declination));
                } else {
                    this.magneticAzimuth(null);
                }
                this.distance(points.start.distanceTo(points.end));

            } else {
                this.distance(null);
                this.trueAzimuth(null);
                this.magneticAzimuth(null);
            }
        },

        onMapClick: function(e) {
            if (!this.points.start && !this.points.end) {
                this.setPoints({start: e.latlng})
            } else if (this.points.start && !this.points.end) {
                this.setPoints({end: e.latlng})
            } else if (this.points.start && this.points.end) {
                this.hideProfile();
                this.setPoints({start: e.latlng, end: null})
            }
        },

        showProfile: function() {
            if (!this.points.end) {
                return;
            }
            if (this.elevationControl) {
                this.elevationControl.removeFrom(this._map);
            }

            const dist = this.points.start.distanceTo(this.points.end);
            this.elevationControl = new ElevationProfile(this._map, [this.points.start, this.points.end], {
                samplingInterval: calcSamplingInterval(dist),
                sightLine: true
            });
            this.elevationControl.on('remove', () => this.elevationControl = null);
            this.fire('elevation-shown');

        },

        hideProfile: function() {
            if (this.elevationControl) {
                this.elevationControl.removeFrom(this._map);
            }
            this.elevationControl = null;
        },

        onProfileButtonClick: function() {
            this.showProfile();
        },

        onReverseButtonClick: function() {
            if (this.points.end && this.points.start) {
                this.setPoints({start: this.points.end, end: this.points.start});
                if (this.elevationControl) {
                    this.showProfile();
                }

            }
        }

    }
);

