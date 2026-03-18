export namespace main {
	
	export class Messung {
	    datum: string;
	    fertigungsbereich: string;
	    abteilung_zsb: string;
	    abteilung_uzsb: string;
	    name: string;
	    batch_nr: string;
	    station: string;
	    pruefzweck: string;
	    pruefart: string;
	    einstellmassnahme: string;
	    nok_id: string;
	    bemerkungen: string;
	    messung_planmaessig: string;
	    ausgeschleust: string;
	
	    static createFrom(source: any = {}) {
	        return new Messung(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.datum = source["datum"];
	        this.fertigungsbereich = source["fertigungsbereich"];
	        this.abteilung_zsb = source["abteilung_zsb"];
	        this.abteilung_uzsb = source["abteilung_uzsb"];
	        this.name = source["name"];
	        this.batch_nr = source["batch_nr"];
	        this.station = source["station"];
	        this.pruefzweck = source["pruefzweck"];
	        this.pruefart = source["pruefart"];
	        this.einstellmassnahme = source["einstellmassnahme"];
	        this.nok_id = source["nok_id"];
	        this.bemerkungen = source["bemerkungen"];
	        this.messung_planmaessig = source["messung_planmaessig"];
	        this.ausgeschleust = source["ausgeschleust"];
	    }
	}

}

